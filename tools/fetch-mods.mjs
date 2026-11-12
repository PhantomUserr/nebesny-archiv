#!/usr/bin/env node
/**
 * Nebesny Archiv mod fetcher.
 * Resolves Modrinth versions for MC 1.21.1 / NeoForge, downloads jars,
 * resolves required dependencies recursively, writes resolved.json.
 *
 * Usage:
 *   node fetch-mods.mjs [--manifest mods.manifest.json] [--out <mods dir>]
 *                       [--concurrency 4] [--dry] [--only slug1,slug2]
 */
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const GAME = "1.21.1";
const LOADER = "neoforge";
const UA = "nebesny-archiv-pack/1.0 (modpack builder)";

const args = process.argv.slice(2);
function arg(name, def = null) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
}
const has = (name) => args.includes(`--${name}`);

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const manifestPath = path.resolve(arg("manifest", path.join(here, "..", "mods.manifest.json")));
const outDir = path.resolve(arg("out", "C:/Users/qwert/.minecraftx/instances/Nebesny Archiv/mods"));
const resolvedPath = path.resolve(arg("resolved", path.join(here, "..", "research", "resolved.json")));
const concurrency = Number(arg("concurrency", "4"));
const dry = has("dry");
const only = arg("only") ? new Set(arg("only").split(",").map((s) => s.trim())) : null;

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const entries = (manifest.mods ?? manifest).filter((m) => !only || only.has(m.slug));
await mkdir(outDir, { recursive: true });
await mkdir(path.dirname(resolvedPath), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(url, tries = 5) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.status === 404) return null;
      if (res.status === 429) {
        const wait = Number(res.headers.get("retry-after") ?? "5") * 1000;
        console.warn(`  429, waiting ${wait} ms`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt === tries) throw e;
      await sleep(800 * attempt);
    }
  }
  return null;
}

const versionCache = new Map();
async function versionsFor(idOrSlug) {
  if (versionCache.has(idOrSlug)) return versionCache.get(idOrSlug);
  const q = `game_versions=${encodeURIComponent(JSON.stringify([GAME]))}&loaders=${encodeURIComponent(JSON.stringify([LOADER]))}`;
  const data = await api(`https://api.modrinth.com/v2/project/${encodeURIComponent(idOrSlug)}/version?${q}`);
  const list = Array.isArray(data) ? data : [];
  versionCache.set(idOrSlug, list);
  return list;
}

function pickVersion(list, pin) {
  if (!list.length) return null;
  if (pin) {
    return (
      list.find((v) => v.version_number === pin) ??
      list.find((v) => v.version_number.includes(pin)) ??
      null
    );
  }
  const release = list.find((v) => v.version_type === "release");
  return release ?? list[0];
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function download(file, dest) {
  const res = await fetch(file.url, { headers: { "User-Agent": UA } });
  if (!res.ok || !res.body) throw new Error(`download HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  const buf = await readFile(dest);
  const sha512 = createHash("sha512").update(buf).digest("hex");
  if (file.hashes?.sha512 && sha512 !== file.hashes.sha512) {
    throw new Error(`sha512 mismatch for ${path.basename(dest)}`);
  }
}

const resolved = new Map(); // project_id -> record
const missing = [];
const failed = [];

async function resolveEntry(entry, { isDep = false, parent = null } = {}) {
  const key = entry.projectId ?? entry.slug;
  if (!key) return;
  if (resolved.has(key)) return;

  // reserve slot to avoid duplicate concurrent work
  resolved.set(key, { status: "pending", slug: entry.slug ?? key });

  let list;
  try {
    list = await versionsFor(entry.slug ?? entry.projectId);
  } catch (e) {
    resolved.delete(key);
    failed.push({ slug: entry.slug ?? key, error: String(e) });
    return;
  }
  const version = pickVersion(list, entry.version);
  if (!version) {
    resolved.delete(key);
    missing.push({ slug: entry.slug ?? key, side: entry.side ?? "both", category: entry.category ?? (isDep ? "dependency" : "?"), parent });
    return;
  }
  const file = version.files?.find((f) => f.primary) ?? version.files?.[0];
  if (!file) {
    resolved.delete(key);
    missing.push({ slug: entry.slug ?? key, note: "no file", parent });
    return;
  }

  const record = {
    status: "ok",
    slug: entry.slug ?? key,
    projectId: version.project_id,
    title: entry.title ?? null,
    versionNumber: version.version_number,
    versionId: version.id,
    filename: file.filename,
    url: file.url,
    sha512: file.hashes?.sha512 ?? null,
    side: entry.side ?? (isDep ? "both" : "both"),
    category: entry.category ?? (isDep ? "dependency" : "?"),
    dependencyOf: parent,
    deps: (version.dependencies ?? []).map((d) => ({ type: d.dependency_type, projectId: d.project_id })),
  };
  resolved.set(key, record);
  if (!record.title) {
    const p = await api(`https://api.modrinth.com/v2/project/${record.projectId}`);
    if (p?.title) record.title = p.title;
  }

  if (!dry) {
    const dest = path.join(outDir, file.filename);
    if (await exists(dest)) {
      record.downloaded = "cached";
    } else {
      try {
        await download(file, dest);
        record.downloaded = "yes";
        console.log(`  + ${file.filename}  (${record.title})`);
      } catch (e) {
        record.downloaded = "error";
        record.error = String(e);
        failed.push({ slug: record.slug, error: String(e) });
        console.error(`  ! ${file.filename}: ${e}`);
      }
    }
  }

  // required deps
  for (const dep of record.deps) {
    if (dep.type !== "required" || !dep.projectId) continue;
    await resolveEntry({ projectId: dep.projectId, category: "dependency", side: "both" }, { isDep: true, parent: record.slug });
  }
}

const queue = [...entries];
let active = 0;
let index = 0;
const total = queue.length;
console.log(`Resolving ${total} top-level mods for ${GAME}/${LOADER} -> ${outDir}`);

await new Promise((resolveAll) => {
  function next() {
    while (active < concurrency && index < total) {
      const entry = queue[index++];
      active++;
      resolveEntry(entry)
        .catch((e) => failed.push({ slug: entry.slug, error: String(e) }))
        .finally(() => {
          active--;
          if (index >= total && active === 0) resolveAll();
          else next();
        });
    }
    if (total === 0) resolveAll();
  }
  next();
});

const records = [...resolved.values()].filter((r) => r.status === "ok");
const summary = {
  generatedAt: new Date().toISOString(),
  game: GAME,
  loader: LOADER,
  manifest: path.basename(manifestPath),
  modsDir: outDir,
  totalRequested: total,
  totalResolved: records.length,
  downloadedBytes: 0,
  missing,
  failed,
  mods: records
    .filter((r) => r.status === "ok")
    .sort((a, b) => (a.category + a.slug).localeCompare(b.category + b.slug)),
};
await writeFile(resolvedPath, JSON.stringify(summary, null, 2));

console.log(`\nResolved ${records.length} jars. Missing: ${missing.length}, failed: ${failed.length}`);
if (missing.length) {
  console.log("\nMISSING (not available for 1.21.1 neoforge or wrong slug):");
  for (const m of missing) console.log(`  - ${m.slug}${m.parent ? `  <- ${m.parent}` : ""}`);
}
if (failed.length) {
  console.log("\nFAILED:");
  for (const f of failed) console.log(`  - ${f.slug}: ${f.error}`);
}
console.log(`\nManifest: ${resolvedPath}`);
