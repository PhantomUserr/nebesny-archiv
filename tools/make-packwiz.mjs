// Builds a packwiz pack from the live client instance:
//  - hashes every jar in instance/mods and resolves it through Modrinth's version_files API
//  - writes mods/<slug>.pw.toml metafiles with exact versions and sha512 hashes
//  - copies jars that Modrinth doesn't know into packwiz/mods so they are still distributed
//  - copies curated config/kubejs overrides
// Usage: node tools/make-packwiz.mjs
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, copyFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';

const ROOT = 'C:/Users/qwert/Desktop/GDZ/nebo-archiv';
const INSTANCE = 'C:/Users/qwert/.minecraftx/instances/Nebesny Archiv';
const PACK = join(ROOT, 'packwiz');
const MODS_OUT = join(PACK, 'mods');
const API = 'https://api.modrinth.com/v2';
const UA = 'nebesny-archiv/1.0 (packwiz build script)';

const sha512 = (buf) => createHash('sha512').update(buf).digest('hex');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const manifestSides = new Map();
for (const file of ['mods.manifest.json', 'libs.manifest.json']) {
  const data = JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
  for (const m of data.mods) manifestSides.set(m.slug, m.side);
}

const clientDir = join(INSTANCE, 'mods');
const serverDir = join(ROOT, 'server-test', 'mods');
const serverNames = new Set(readdirSync(serverDir).filter((f) => f.endsWith('.jar')));
const jars = readdirSync(clientDir).filter((f) => f.endsWith('.jar')).sort();

console.log(`jars: ${jars.length}; server jars: ${serverNames.size}`);

const entries = jars.map((filename) => {
  const buf = readFileSync(join(clientDir, filename));
  return {
    filename,
    buf,
    sha512: sha512(buf),
    side: serverNames.has(filename) ? 'both' : 'client',
  };
});

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const resolved = await postJson(`${API}/version_files`, {
  hashes: entries.map((e) => e.sha512),
  algorithm: 'sha512',
});

const unmatched = entries.filter((e) => !resolved[e.sha512]);
console.log(`resolved on Modrinth: ${entries.length - unmatched.length}; unmatched: ${unmatched.length}`);
if (unmatched.length) console.log('unmatched files:\n  ' + unmatched.map((e) => e.filename).join('\n  '));

const projectIds = [...new Set(Object.values(resolved).map((v) => v.project_id))];
const projects = [];
for (let i = 0; i < projectIds.length; i += 50) {
  const chunk = projectIds.slice(i, i + 50);
  const list = await getJson(`${API}/projects?ids=${encodeURIComponent(JSON.stringify(chunk))}`);
  projects.push(...list);
}
const projectById = new Map(projects.map((p) => [p.id, p]));
console.log(`projects fetched: ${projects.length}`);

rmSync(MODS_OUT, { recursive: true, force: true });
mkdirSync(MODS_OUT, { recursive: true });

const tomlString = (s) => JSON.stringify(s);
const written = [];

for (const e of entries) {
  const version = resolved[e.sha512];
  if (!version) {
    copyFileSync(join(clientDir, e.filename), join(MODS_OUT, e.filename));
    continue;
  }
  const project = projectById.get(version.project_id);
  if (!project) {
    copyFileSync(join(clientDir, e.filename), join(MODS_OUT, e.filename));
    continue;
  }
  const file = version.files.find((f) => f.hashes.sha512 === e.sha512) || version.files[0];
  let side = e.side;
  const manifestSide = manifestSides.get(project.slug);
  if (manifestSide === 'client') side = 'client';
  if (manifestSide === 'server') side = 'server';

  const slug = project.slug || project.id;
  const lines = [
    `name = ${tomlString(project.title)}`,
    `filename = ${tomlString(file.filename)}`,
    `side = ${tomlString(side)}`,
    '',
    '[download]',
    `url = ${tomlString(file.url)}`,
    'hash-format = "sha512"',
    `hash = ${tomlString(file.hashes.sha512)}`,
    '',
    '[update.modrinth]',
    `mod-id = ${tomlString(project.id)}`,
    `version = ${tomlString(version.id)}`,
    '',
  ];
  writeFileSync(join(MODS_OUT, `${slug}.pw.toml`), lines.join('\n'));
  written.push(slug);
}

console.log(`packwiz metafiles: ${written.length}; raw jars copied: ${unmatched.length}`);

// Curated overrides: quests, tips/scripts, and visual defaults.
const overrides = ['config/ftbquests', 'kubejs'];
for (const rel of overrides) {
  const src = join(INSTANCE, rel);
  if (!existsSync(src)) continue;
  const dst = join(PACK, rel);
  rmSync(dst, { recursive: true, force: true });
  copyRecursive(src, dst);
}
copyIfExists(join(INSTANCE, 'config/iris.properties'), join(PACK, 'config/iris.properties'));

// Remove generated/cache noise that must not be distributed.
for (const rel of ['kubejs/config', 'kubejs/local', 'kubejs/logs']) {
  rmSync(join(PACK, rel), { recursive: true, force: true });
}

function copyRecursive(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const item of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, item.name);
    const d = join(dst, item.name);
    if (item.isDirectory()) copyRecursive(s, d);
    else copyFileSync(s, d);
  }
}

function copyIfExists(src, dst) {
  if (!existsSync(src)) return;
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
}

writeFileSync(join(ROOT, 'research', 'packwiz-resolved.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  total: entries.length,
  metafiles: written.length,
  unmatched: unmatched.map((e) => e.filename),
}, null, 2));

console.log('done');
