'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');
const { Rcon } = require('rcon-client');

const PORT = Number(process.env.PANEL_PORT || 8080);
const DATA_DIR = process.env.PANEL_DATA || path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'servers.json');
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.log');
const BRAND_FILE = path.join(DATA_DIR, 'panel.json');
const PASSWORD_FILE = path.join(__dirname, '.password');
const SECRET_FILE = path.join(__dirname, '.secret');
const DEFAULT_PASSWORD = process.env.PANEL_PASSWORD || 'nebesny2026';

const MAX_TEXT = 2 * 1024 * 1024;
const MAX_UPLOAD = 512 * 1024 * 1024;

let brand = { name: 'MCPanel', tagline: 'панель серверов' };
try {
  Object.assign(brand, JSON.parse(fs.readFileSync(BRAND_FILE, 'utf8')));
} catch {
  /* no brand file yet */
}
if (process.env.PANEL_NAME) brand.name = process.env.PANEL_NAME;

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

// ---------------------------------------------------------------- auth

function readSecret() {
  try {
    return fs.readFileSync(SECRET_FILE);
  } catch {
    const s = crypto.randomBytes(32);
    fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
    return s;
  }
}

const SECRET = readSecret();
const TOKEN = crypto.createHmac('sha256', SECRET).update('mcpanel-v2').digest('hex');
const attempts = new Map();

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(pw, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const hash = crypto.scryptSync(pw, parts[1], 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(parts[2], 'hex'));
  } catch {
    return false;
  }
}

function loadPasswordHash() {
  try {
    return fs.readFileSync(PASSWORD_FILE, 'utf8').trim();
  } catch {
    const h = hashPassword(DEFAULT_PASSWORD);
    fs.writeFileSync(PASSWORD_FILE, h, { mode: 0o600 });
    return h;
  }
}

let passwordHash = loadPasswordHash();

function tooMany(ip) {
  const now = Date.now();
  const arr = (attempts.get(ip) || []).filter((t) => now - t < 60000);
  attempts.set(ip, arr);
  return arr.length >= 8;
}

function noteAttempt(ip, ok) {
  if (ok) {
    attempts.delete(ip);
    return;
  }
  const arr = attempts.get(ip) || [];
  arr.push(Date.now());
  attempts.set(ip, arr);
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function auth(req, res, next) {
  if (getCookie(req, 'panel_token') === TOKEN) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

// ---------------------------------------------------------------- servers config

function slugify(value) {
  const s = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return s || 'server';
}

function normalizeServer(raw) {
  const s = raw || {};
  const id = s.id || slugify(s.name);
  const memory = s.memory || {};
  const ab = s.autobackup || {};
  return {
    id,
    name: s.name || id,
    description: s.description || '',
    icon: s.icon || '🎮',
    dir: s.dir || '/home/server/' + id,
    unit: s.unit || 'mc-' + id,
    gamePort: Number(s.gamePort) || 25565,
    rconPort: Number(s.rconPort) || 25575,
    rconPassword: s.rconPassword || '',
    mcVersion: s.mcVersion || '1.21.1',
    loader: s.loader || 'NeoForge',
    memory: {
      min: String(memory.min || '3G'),
      max: String(memory.max || '4G'),
    },
    autobackup: {
      enabled: Boolean(ab.enabled),
      everyHours: Math.min(168, Math.max(1, Number(ab.everyHours) || 6)),
      keep: Math.min(50, Math.max(1, Number(ab.keep) || 5)),
      scope: ['world', 'config', 'full'].includes(ab.scope) ? ab.scope : 'world',
    },
  };
}

let servers = [];
let configError = null;

function defaultServers() {
  return [
    normalizeServer({
      id: 'nebesny-archiv',
      name: 'Небесный Архив',
      description: 'Сюжетная сборка на 1.21.1',
      icon: '☁',
      dir: process.env.SERVER_DIR || '/home/server/nebesny-archiv',
      unit: process.env.SERVER_UNIT || 'nebesny-archiv',
      gamePort: 25565,
      rconPort: Number(process.env.RCON_PORT || 25575),
      rconPassword: process.env.RCON_PASSWORD || '',
      mcVersion: '1.21.1',
      loader: 'NeoForge',
      memory: { min: '3G', max: '4G' },
    }),
  ];
}

function saveServers() {
  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ servers }, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, CONFIG_FILE);
  try {
    fs.chmodSync(CONFIG_FILE, 0o600);
  } catch {
    /* ignore */
  }
}

function loadServers() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    servers = (Array.isArray(raw.servers) ? raw.servers : []).map(normalizeServer);
    configError = null;
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      servers = defaultServers();
      saveServers();
    } else {
      configError = String((e && e.message) || e);
      servers = [];
    }
  }
}

function getServer(id) {
  return servers.find((s) => s.id === id) || null;
}

function publicServer(s) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    icon: s.icon,
    dir: s.dir,
    unit: s.unit,
    gamePort: s.gamePort,
    rconPort: s.rconPort,
    mcVersion: s.mcVersion,
    loader: s.loader,
    memory: s.memory,
    autobackup: s.autobackup,
  };
}

loadServers();

// ---------------------------------------------------------------- shell helpers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        error: error || null,
      });
    });
  });
}

function sudo(args, timeout = 30000) {
  return run('sudo', ['-n', ...args], timeout);
}

function systemctl(srv, args, timeout = 30000) {
  return sudo(['/usr/bin/systemctl', ...args, srv.unit], timeout);
}

async function isActive(srv) {
  const r = await systemctl(srv, ['is-active']);
  return r.stdout.trim() === 'active';
}

async function waitInactive(srv, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (!(await isActive(srv))) return true;
    await sleep(2000);
  }
  return false;
}

function lanAddress() {
  const list = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) list.push(a.address);
    }
  }
  return list.find((a) => a.startsWith('192.168.')) || list[0] || '127.0.0.1';
}

function diskInfo(target) {
  try {
    const st = fs.statfsSync(target);
    const total = Number(st.blocks) * Number(st.bsize);
    const free = Number(st.bavail) * Number(st.bsize);
    return { total, free, used: total - free };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- rcon / server info

async function rconSend(srv, command) {
  const conn = await Rcon.connect({
    host: '127.0.0.1',
    port: srv.rconPort,
    password: srv.rconPassword,
    timeout: 4000,
  });
  try {
    return await conn.send(command);
  } finally {
    try {
      await conn.end();
    } catch {
      /* ignore */
    }
  }
}

function parsePlayerList(text) {
  const m = String(text).match(/There are (\d+) of a max of (\d+) players online:?\s*(.*)/i);
  if (!m) return null;
  return {
    online: Number(m[1]),
    max: Number(m[2]),
    names: m[3].split(/,\s*/).map((s) => s.trim()).filter(Boolean),
  };
}

function readProps(srv) {
  const map = {};
  try {
    const raw = fs.readFileSync(path.join(srv.dir, 'server.properties'), 'utf8').replace(/^\uFEFF/, '');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) map[m[1].trim()] = m[2];
    }
  } catch {
    /* ignore */
  }
  return map;
}

function countJars(srv) {
  try {
    const files = fs.readdirSync(path.join(srv.dir, 'mods'));
    return {
      enabled: files.filter((f) => /\.jar$/i.test(f)).length,
      disabled: files.filter((f) => /\.jar\.disabled$/i.test(f)).length,
    };
  } catch {
    return { enabled: 0, disabled: 0 };
  }
}

function neoforgeVersion(srv) {
  try {
    const base = path.join(srv.dir, 'libraries', 'net', 'neoforged', 'neoforge');
    const dirs = fs.readdirSync(base).filter((d) => /^\d/.test(d));
    return dirs.sort().pop() || '—';
  } catch {
    return '—';
  }
}

const worldCache = new Map();

async function refreshWorldSize(srv) {
  const cached = worldCache.get(srv.id);
  if (cached && (cached.pending || Date.now() - cached.ts < 300000)) return;
  worldCache.set(srv.id, { ts: Date.now(), value: cached ? cached.value : 0, pending: true });
  let value = 0;
  for (const d of ['world', 'world_nether', 'world_the_end']) {
    const r = await run('du', ['-sb', path.join(srv.dir, d)], 20000);
    if (r.code === 0) value += Number(String(r.stdout).split(/\s/)[0]) || 0;
  }
  worldCache.set(srv.id, { ts: Date.now(), value, pending: false });
}

function cachedWorldSize(srv) {
  const c = worldCache.get(srv.id);
  return c ? c.value : 0;
}

async function serverStatus(srv) {
  refreshWorldSize(srv);
  const [act, en] = await Promise.all([systemctl(srv, ['is-active']), systemctl(srv, ['is-enabled'])]);
  const active = act.stdout.trim() === 'active';
  const enabled = en.stdout.trim() === 'enabled';

  let pid = 0;
  let uptime = 0;
  let rssKb = 0;
  if (active) {
    const p = await systemctl(srv, ['show', '-p', 'MainPID', '--value']);
    pid = Number(p.stdout.trim()) || 0;
    if (pid) {
      const [etimes, rss] = await Promise.all([
        run('ps', ['-o', 'etimes=', '-p', String(pid)]),
        run('ps', ['-o', 'rss=', '-p', String(pid)]),
      ]);
      uptime = Number(etimes.stdout.trim()) || 0;
      rssKb = Number(rss.stdout.trim()) || 0;
    }
  }

  let players = null;
  if (active) {
    try {
      players = parsePlayerList(await rconSend(srv, 'list'));
    } catch {
      players = null;
    }
  }

  const props = readProps(srv);
  const jars = countJars(srv);
  const port = Number(props['server-port']) || srv.gamePort;

  return {
    ...publicServer(srv),
    active,
    enabled,
    pid,
    uptime,
    rssKb,
    port,
    address: lanAddress(),
    players,
    mods: jars.enabled,
    modsDisabled: jars.disabled,
    neoforge: neoforgeVersion(srv),
    worldSize: cachedWorldSize(srv),
    memTotal: os.totalmem(),
    memFree: os.freemem(),
  };
}

// ---------------------------------------------------------------- activity log

function logActivity(srv, action, detail) {
  const rec = {
    ts: Date.now(),
    sid: srv ? srv.id : null,
    server: srv ? srv.name : null,
    action: String(action || 'other'),
    detail: String(detail == null ? '' : detail).slice(0, 400),
  };
  try {
    fs.appendFileSync(ACTIVITY_FILE, JSON.stringify(rec) + '\n', { mode: 0o600 });
  } catch {
    /* журнал не критичен */
  }
}

function readActivity(sid, limit) {
  let raw = '';
  try {
    raw = fs.readFileSync(ACTIVITY_FILE, 'utf8');
  } catch {
    return [];
  }
  const lines = raw.split('\n').filter(Boolean);
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i -= 1) {
    try {
      const rec = JSON.parse(lines[i]);
      if (sid && rec.sid !== sid) continue;
      out.push(rec);
    } catch {
      /* битая строка */
    }
  }
  return out;
}

// ---------------------------------------------------------------- misc helpers

function bad(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function offlineUuid(name) {
  const hash = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function timestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-` +
    `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

function insideDir(root, rel) {
  const base = path.resolve(root);
  const cleaned = String(rel == null ? '' : rel).replace(/^[/\\]+/, '');
  const target = path.resolve(base, cleaned);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function atomicWrite(file, content) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  let mode = 0o644;
  try {
    mode = fs.statSync(file).mode & 0o777;
  } catch {
    /* новый файл */
  }
  fs.writeFileSync(tmp, content, { mode });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
}

function readJsonFile(file, fallback) {
  try {
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function writeJsonFile(file, value) {
  atomicWrite(file, JSON.stringify(value, null, 2) + '\n');
}

const PLAYER_RE = /^[A-Za-z0-9_]{1,16}$/;
const BACKUP_RE = /^(auto-)?(world|config|full)-\d{8}-\d{6}\.tar\.gz$/;

// ---------------------------------------------------------------- app / api

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));

const api = express.Router();

app.post('/api/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (tooMany(ip)) return res.status(429).json({ error: 'Слишком много попыток. Подождите минуту.' });
  const pw = String((req.body && req.body.password) || '');
  if (!pw || !verifyPassword(pw, passwordHash)) {
    noteAttempt(ip, false);
    return res.status(401).json({ error: 'Неверный пароль' });
  }
  noteAttempt(ip, true);
  res.setHeader(
    'Set-Cookie',
    `panel_token=${encodeURIComponent(TOKEN)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
  );
  res.json({ ok: true, brand });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'panel_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

api.use(auth);
api.use('/servers/:sid', (req, res, next) => {
  const srv = getServer(req.params.sid);
  if (!srv) return res.status(404).json({ error: 'Сервер не найден' });
  req.srv = srv;
  return next();
});

// ---------------------------------------------------------------- overview

api.get('/overview', async (req, res, next) => {
  try {
    const disk = diskInfo('/') || diskInfo(DATA_DIR) || null;
    const list = await Promise.all(
      servers.map(async (srv) => {
        const active = await isActive(srv);
        const props = readProps(srv);
        const jars = countJars(srv);
        return {
          ...publicServer(srv),
          active,
          port: Number(props['server-port']) || srv.gamePort,
          address: lanAddress(),
          mods: jars.enabled,
          modsDisabled: jars.disabled,
          players: null,
        };
      }),
    );

    res.json({
      brand,
      host: {
        hostname: os.hostname(),
        address: lanAddress(),
        uptime: Math.round(os.uptime()),
        load: os.loadavg().map((n) => Number(n.toFixed(2))),
        mem: { total: os.totalmem(), free: os.freemem() },
        disk,
        platform: `${os.type()} ${os.release()}`,
        node: process.version,
      },
      servers: list,
      configError,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- servers crud

api.get('/servers', (req, res) => {
  res.json({ servers: servers.map(publicServer), configError });
});

api.post('/servers', async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name || name.length > 64) return res.status(400).json({ error: 'Укажите название (до 64 символов)' });

    const dir = String(b.dir || '').trim();
    if (!path.isAbsolute(dir)) return res.status(400).json({ error: 'Путь к папке сервера должен быть абсолютным' });
    let st;
    try {
      st = await fsp.stat(dir);
    } catch {
      return res.status(400).json({ error: 'Папка сервера не найдена на диске' });
    }
    if (!st.isDirectory()) return res.status(400).json({ error: 'Указанный путь не является папкой' });

    const unit = String(b.unit || 'mc-' + slugify(name)).trim();
    if (!/^[A-Za-z0-9_.@-]+$/.test(unit)) {
      return res.status(400).json({ error: 'Недопустимое имя службы: разрешены буквы, цифры, точка, дефис и @' });
    }
    if (servers.some((s) => s.unit === unit)) {
      return res.status(409).json({ error: 'Эта служба уже используется другим сервером' });
    }

    const gamePort = Number(b.gamePort || 25565);
    const rconPort = Number(b.rconPort || 25575);
    if (!Number.isInteger(gamePort) || gamePort < 1 || gamePort > 65535) {
      return res.status(400).json({ error: 'Некорректный игровой порт' });
    }
    if (!Number.isInteger(rconPort) || rconPort < 1 || rconPort > 65535) {
      return res.status(400).json({ error: 'Некорректный RCON-порт' });
    }

    let id = slugify(b.id || name);
    let n = 2;
    while (servers.some((s) => s.id === id)) {
      id = `${slugify(b.id || name).slice(0, 28)}-${n}`;
      n += 1;
    }

    const srv = normalizeServer({
      id,
      name,
      description: String(b.description || '').slice(0, 200),
      icon: String(b.icon || '🎮').slice(0, 8),
      dir,
      unit,
      gamePort,
      rconPort,
      rconPassword: String(b.rconPassword || ''),
      mcVersion: String(b.mcVersion || '1.21.1').slice(0, 32),
      loader: String(b.loader || 'NeoForge').slice(0, 32),
      memory: b.memory,
      autobackup: b.autobackup,
    });
    servers.push(srv);
    saveServers();
    logActivity(srv, 'server-add', `${srv.name} · ${srv.dir}`);

    let warning = null;
    const cat = await run('systemctl', ['cat', srv.unit], 8000);
    if (cat.code !== 0) {
      warning = `Служба ${srv.unit} не найдена (systemctl cat). Сервер добавлен, но управление может не работать, пока вы не создадите unit.`;
    }
    res.json({ server: publicServer(srv), warning });
  } catch (e) {
    next(e);
  }
});

api.patch('/servers/:sid', (req, res, next) => {
  try {
    const srv = req.srv;
    const b = req.body || {};
    const patch = {};

    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (!name || name.length > 64) return res.status(400).json({ error: 'Название: от 1 до 64 символов' });
      patch.name = name;
    }
    if (b.description !== undefined) patch.description = String(b.description).slice(0, 200);
    if (b.icon !== undefined) patch.icon = String(b.icon).slice(0, 8) || '🎮';
    if (b.gamePort !== undefined) {
      const p = Number(b.gamePort);
      if (!Number.isInteger(p) || p < 1 || p > 65535) return res.status(400).json({ error: 'Некорректный игровой порт' });
      patch.gamePort = p;
    }
    if (b.rconPort !== undefined) {
      const p = Number(b.rconPort);
      if (!Number.isInteger(p) || p < 1 || p > 65535) return res.status(400).json({ error: 'Некорректный RCON-порт' });
      patch.rconPort = p;
    }
    if (b.mcVersion !== undefined) patch.mcVersion = String(b.mcVersion).slice(0, 32);
    if (b.loader !== undefined) patch.loader = String(b.loader).slice(0, 32);

    Object.assign(srv, normalizeServer({ ...srv, ...patch }));
    saveServers();
    logActivity(srv, 'server-edit', srv.name);
    res.json({ server: publicServer(srv) });
  } catch (e) {
    next(e);
  }
});

api.delete('/servers/:sid', (req, res) => {
  const srv = req.srv;
  servers = servers.filter((s) => s.id !== srv.id);
  saveServers();
  logActivity(srv, 'server-remove', `${srv.name} · файлы оставлены`);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- actions / players / command

api.get('/servers/:sid/status', async (req, res, next) => {
  try {
    res.json(await serverStatus(req.srv));
  } catch (e) {
    next(e);
  }
});

api.post('/servers/:sid/action', async (req, res, next) => {
  try {
    const srv = req.srv;
    const action = String((req.body && req.body.action) || '');
    if (!['start', 'stop', 'restart', 'kill'].includes(action)) {
      return res.status(400).json({ error: 'Неизвестное действие' });
    }
    let r;
    if (action === 'kill') {
      r = await sudo(['/usr/bin/systemctl', 'kill', '-s', 'SIGKILL', srv.unit], 30000);
    } else {
      r = await systemctl(srv, [action], 60000);
    }
    if (r.code !== 0) {
      return res.status(500).json({ error: (r.stderr || r.stdout || 'systemctl завершился с ошибкой').trim() });
    }
    logActivity(srv, action, action === 'kill' ? 'принудительное завершение' : `systemctl ${action}`);
    res.json({ ok: true, action });
  } catch (e) {
    next(e);
  }
});

api.get('/servers/:sid/players', async (req, res, next) => {
  try {
    const srv = req.srv;
    if (!(await isActive(srv))) {
      return res.json({ ok: false, error: 'Сервер выключен', online: 0, max: 0, names: [] });
    }
    try {
      const parsed = parsePlayerList(await rconSend(srv, 'list'));
      if (!parsed) return res.json({ ok: false, error: 'Не удалось разобрать ответ RCON', online: 0, max: 0, names: [] });
      res.json({ ok: true, ...parsed });
    } catch (e) {
      res.json({ ok: false, error: 'RCON недоступен: ' + String(e.message || e), online: 0, max: 0, names: [] });
    }
  } catch (e) {
    next(e);
  }
});

api.post('/servers/:sid/command', async (req, res, next) => {
  try {
    const srv = req.srv;
    const command = String((req.body && req.body.command) || '').trim();
    if (!command) return res.status(400).json({ error: 'Пустая команда' });
    if (command.length > 1000) return res.status(400).json({ error: 'Команда слишком длинная' });
    if (!(await isActive(srv))) return res.status(409).json({ error: 'Сервер выключен' });
    try {
      const output = await rconSend(srv, command);
      logActivity(srv, 'command', command);
      res.json({ ok: true, output });
    } catch (e) {
      res.status(502).json({ error: 'RCON: ' + String(e.message || e) });
    }
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- activity

api.get('/activity', (req, res) => {
  const sid = String(req.query.sid || '');
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 30));
  res.json({ entries: readActivity(sid || null, limit) });
});

// ---------------------------------------------------------------- access lists

const ACCESS_FILES = {
  whitelist: 'whitelist.json',
  ops: 'ops.json',
  banned: 'banned-players.json',
};

function readAccess(srv) {
  const wl = readJsonFile(path.join(srv.dir, ACCESS_FILES.whitelist), []);
  const ops = readJsonFile(path.join(srv.dir, ACCESS_FILES.ops), []);
  const banned = readJsonFile(path.join(srv.dir, ACCESS_FILES.banned), []);
  const norm = (arr, mapper) => (Array.isArray(arr) ? arr.filter((x) => x && x.name).map(mapper) : []);
  return {
    whitelist: norm(wl, (x) => ({ name: String(x.name), uuid: x.uuid || offlineUuid(x.name) })),
    ops: norm(ops, (x) => ({
      name: String(x.name),
      uuid: x.uuid || offlineUuid(x.name),
      level: Number(x.level) || 4,
      bypassesPlayerLimit: Boolean(x.bypassesPlayerLimit),
    })),
    banned: norm(banned, (x) => ({
      name: String(x.name),
      uuid: x.uuid || offlineUuid(x.name),
      reason: x.reason || '',
      source: x.source || '',
      created: x.created || '',
      expires: x.expires || 'forever',
    })),
  };
}

api.get('/servers/:sid/access', (req, res) => {
  res.json(readAccess(req.srv));
});

api.post('/servers/:sid/access', async (req, res, next) => {
  try {
    const srv = req.srv;
    const b = req.body || {};
    const list = String(b.list || '');
    const action = String(b.action || '');
    const name = String(b.name || '').trim();
    if (!ACCESS_FILES[list]) return res.status(400).json({ error: 'Неизвестный список' });
    if (!['add', 'remove'].includes(action)) return res.status(400).json({ error: 'Неизвестное действие' });
    if (!PLAYER_RE.test(name)) return res.status(400).json({ error: 'Ник: 1–16 символов, латиница, цифры и _' });

    const active = await isActive(srv);
    let via = 'file';
    let rconError = null;

    if (active) {
      let cmd;
      if (list === 'whitelist') cmd = `whitelist ${action === 'add' ? 'add' : 'remove'} ${name}`;
      else if (list === 'ops') cmd = `${action === 'add' ? 'op' : 'deop'} ${name}`;
      else cmd = `${action === 'add' ? 'ban' : 'pardon'} ${name}`;
      try {
        await rconSend(srv, cmd);
        via = 'rcon';
        await sleep(400);
      } catch (e) {
        rconError = String(e.message || e);
      }
    }

    if (via === 'file') {
      const file = path.join(srv.dir, ACCESS_FILES[list]);
      const current = readJsonFile(file, []);
      const arr = Array.isArray(current) ? current : [];
      const idx = arr.findIndex((x) => x && String(x.name).toLowerCase() === name.toLowerCase());
      if (action === 'add') {
        if (idx < 0) {
          if (list === 'whitelist') arr.push({ uuid: offlineUuid(name), name });
          else if (list === 'ops') arr.push({ uuid: offlineUuid(name), name, level: 4, bypassesPlayerLimit: false });
          else {
            arr.push({
              uuid: offlineUuid(name),
              name,
              created: new Date().toISOString(),
              source: 'MCPanel',
              expires: 'forever',
              reason: 'Забанен через панель',
            });
          }
        }
      } else if (idx >= 0) {
        arr.splice(idx, 1);
      }
      writeJsonFile(file, arr);
      if (active && list === 'whitelist') {
        try {
          await rconSend(srv, 'whitelist reload');
        } catch {
          /* сервер уже перечитает при следующем изменении */
        }
      }
    }

    logActivity(srv, `access-${list}`, `${action} ${name}${via === 'rcon' ? '' : ' (файл)'}`);
    res.json({ ok: true, via, rconError, ...readAccess(srv) });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- files

api.get('/servers/:sid/files', async (req, res, next) => {
  try {
    const srv = req.srv;
    const rel = String(req.query.path || '').replace(/\\/g, '/');
    const dir = insideDir(srv.dir, rel);
    if (!dir) return res.status(400).json({ error: 'Недопустимый путь' });
    let st;
    try {
      st = await fsp.lstat(dir);
    } catch {
      return res.status(404).json({ error: 'Папка не найдена' });
    }
    if (!st.isDirectory()) return res.status(400).json({ error: 'Это не папка' });

    const entries = [];
    for (const d of await fsp.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, d.name);
      const s = lstatOrNull(full);
      if (!s || s.isSymbolicLink()) continue;
      entries.push({
        name: d.name,
        path: path.posix.join(rel, d.name),
        dir: s.isDirectory(),
        size: s.isDirectory() ? 0 : s.size,
        mtime: s.mtimeMs,
      });
    }
    entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, 'ru'));
    const parentRaw = rel ? path.posix.dirname(rel) : '';
    res.json({
      path: rel,
      parent: parentRaw === '.' ? '' : parentRaw,
      entries,
      root: srv.dir,
    });
  } catch (e) {
    next(e);
  }
});

api.get('/servers/:sid/files/read', async (req, res, next) => {
  try {
    const rel = String(req.query.path || '');
    const file = insideDir(req.srv.dir, rel);
    if (!file) return res.status(400).json({ error: 'Недопустимый путь' });
    const st = lstatOrNull(file);
    if (!st || !st.isFile()) return res.status(404).json({ error: 'Файл не найден' });
    if (st.size > MAX_TEXT) return res.status(413).json({ error: 'Файл больше 2 МБ — скачайте его' });
    const buf = await fsp.readFile(file);
    if (buf.includes(0)) return res.status(415).json({ error: 'Это бинарный файл' });
    res.json({ content: buf.toString('utf8'), size: buf.length });
  } catch (e) {
    next(e);
  }
});

api.post('/servers/:sid/files/write', async (req, res, next) => {
  try {
    const b = req.body || {};
    const rel = String(b.path || '');
    if (typeof b.content !== 'string') return res.status(400).json({ error: 'Нет содержимого' });
    if (b.content.length > MAX_TEXT) return res.status(413).json({ error: 'Содержимое больше 2 МБ' });
    const file = insideDir(req.srv.dir, rel);
    if (!file) return res.status(400).json({ error: 'Недопустимый путь' });
    const st = lstatOrNull(file);
    if (st && st.isDirectory()) return res.status(400).json({ error: 'Это папка' });
    await fsp.mkdir(path.dirname(file), { recursive: true });
    atomicWrite(file, b.content);
    logActivity(req.srv, 'file-write', rel);
    res.json({ ok: true, size: Buffer.byteLength(b.content) });
  } catch (e) {
    next(e);
  }
});

function validName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 200 && !/[/\\]/.test(name) && name !== '.' && name !== '..';
}

api.post('/servers/:sid/files/mkdir', async (req, res, next) => {
  try {
    const b = req.body || {};
    const rel = String(b.path || '');
    const name = String(b.name || '').trim();
    if (!validName(name)) return res.status(400).json({ error: 'Недопустимое имя папки' });
    const dir = insideDir(req.srv.dir, rel);
    if (!dir) return res.status(400).json({ error: 'Недопустимый путь' });
    const target = insideDir(dir, name);
    if (!target) return res.status(400).json({ error: 'Недопустимый путь' });
    await fsp.mkdir(target);
    logActivity(req.srv, 'file-mkdir', path.posix.join(rel, name));
    res.json({ ok: true });
  } catch (e) {
    if (e && e.code === 'EEXIST') return res.status(409).json({ error: 'Такая папка уже есть' });
    next(e);
  }
});

api.post('/servers/:sid/files/rename', async (req, res, next) => {
  try {
    const b = req.body || {};
    const rel = String(b.path || '');
    const name = String(b.name || '').trim();
    if (!validName(name)) return res.status(400).json({ error: 'Недопустимое имя' });
    const src = insideDir(req.srv.dir, rel);
    if (!src || src === path.resolve(req.srv.dir)) return res.status(400).json({ error: 'Недопустимый путь' });
    const st = lstatOrNull(src);
    if (!st) return res.status(404).json({ error: 'Файл не найден' });
    const dst = insideDir(path.dirname(src), name);
    if (!dst) return res.status(400).json({ error: 'Недопустимый путь' });
    if (lstatOrNull(dst)) return res.status(409).json({ error: 'Такое имя уже занято' });
    await fsp.rename(src, dst);
    logActivity(req.srv, 'file-rename', `${rel} → ${name}`);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

api.post('/servers/:sid/files/delete', async (req, res, next) => {
  try {
    const rel = String((req.body && req.body.path) || '');
    const target = insideDir(req.srv.dir, rel);
    if (!target || target === path.resolve(req.srv.dir)) {
      return res.status(400).json({ error: 'Нельзя удалить корневую папку' });
    }
    const st = lstatOrNull(target);
    if (!st) return res.status(404).json({ error: 'Файл не найден' });
    await fsp.rm(target, { recursive: true, force: true });
    logActivity(req.srv, 'file-delete', rel);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

api.get('/servers/:sid/files/download', async (req, res, next) => {
  try {
    const rel = String(req.query.path || '');
    const file = insideDir(req.srv.dir, rel);
    if (!file) return res.status(400).json({ error: 'Недопустимый путь' });
    const st = lstatOrNull(file);
    if (!st || !st.isFile()) return res.status(404).json({ error: 'Файл не найден' });
    res.download(file, path.basename(file));
  } catch (e) {
    next(e);
  }
});

function saveUpload(req, tmpPath) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const out = fs.createWriteStream(tmpPath, { mode: 0o644 });
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try {
        out.destroy();
      } catch {
        /* ignore */
      }
      fsp.unlink(tmpPath).catch(() => {});
      reject(err);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD) {
        fail(bad(413, 'Файл больше 512 МБ'));
        try {
          req.destroy();
        } catch {
          /* ignore */
        }
      }
    });
    req.on('aborted', () => fail(bad(400, 'Загрузка прервана')));
    req.on('error', (e) => fail(e));
    out.on('error', (e) => fail(e));
    out.on('finish', () => {
      if (settled) return;
      settled = true;
      resolve(size);
    });
    req.pipe(out);
  });
}

async function handleUpload(req, dir, name) {
  if (!validName(name)) throw bad(400, 'Недопустимое имя файла');
  await fsp.mkdir(dir, { recursive: true });
  const dest = path.join(dir, name);
  const tmp = `${dest}.part`;
  if (lstatOrNull(dest) && lstatOrNull(dest).isDirectory()) throw bad(409, 'Это папка');
  const size = await saveUpload(req, tmp);
  await fsp.rename(tmp, dest);
  return { size, name };
}

api.post('/servers/:sid/files/upload', async (req, res, next) => {
  try {
    const rel = String(req.query.path || '');
    const name = String(req.query.name || '');
    const dir = insideDir(req.srv.dir, rel);
    if (!dir) return res.status(400).json({ error: 'Недопустимый путь' });
    const result = await handleUpload(req, dir, name);
    logActivity(req.srv, 'file-upload', path.posix.join(rel, name));
    res.json({ ok: true, ...result });
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

// ---------------------------------------------------------------- mods

function modsDir(srv) {
  return path.join(srv.dir, 'mods');
}

api.get('/servers/:sid/mods', async (req, res, next) => {
  try {
    const dir = modsDir(req.srv);
    let names = [];
    try {
      names = await fsp.readdir(dir);
    } catch {
      names = [];
    }
    const mods = [];
    for (const name of names) {
      const isEnabled = /\.jar$/i.test(name);
      const isDisabled = /\.jar\.disabled$/i.test(name);
      if (!isEnabled && !isDisabled) continue;
      const st = lstatOrNull(path.join(dir, name));
      if (!st || !st.isFile()) continue;
      mods.push({ name, size: st.size, mtime: st.mtimeMs, enabled: isEnabled });
    }
    mods.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    res.json({
      mods,
      enabled: mods.filter((m) => m.enabled).length,
      disabled: mods.filter((m) => !m.enabled).length,
    });
  } catch (e) {
    next(e);
  }
});

api.post('/servers/:sid/mods/toggle', async (req, res, next) => {
  try {
    const name = String((req.body && req.body.name) || '');
    if (!/^[^/\\]+\.jar(\.disabled)?$/i.test(name)) return res.status(400).json({ error: 'Некорректное имя мода' });
    const dir = modsDir(req.srv);
    const src = path.join(dir, name);
    const st = lstatOrNull(src);
    if (!st || !st.isFile()) return res.status(404).json({ error: 'Мод не найден' });
    const dstName = /\.disabled$/i.test(name) ? name.replace(/\.disabled$/i, '') : `${name}.disabled`;
    const dst = path.join(dir, dstName);
    if (lstatOrNull(dst)) return res.status(409).json({ error: 'Файл с таким именем уже есть' });
    await fsp.rename(src, dst);
    const enabled = !/\.disabled$/i.test(dstName);
    logActivity(req.srv, 'mod-toggle', `${name} → ${dstName}`);
    const active = await isActive(req.srv);
    res.json({
      ok: true,
      name: dstName,
      enabled,
      warning: active ? 'Изменения применятся после перезапуска сервера' : null,
    });
  } catch (e) {
    next(e);
  }
});

api.post('/servers/:sid/mods/delete', async (req, res, next) => {
  try {
    const name = String((req.body && req.body.name) || '');
    if (!/^[^/\\]+\.jar(\.disabled)?$/i.test(name)) return res.status(400).json({ error: 'Некорректное имя мода' });
    const file = path.join(modsDir(req.srv), name);
    const st = lstatOrNull(file);
    if (!st || !st.isFile()) return res.status(404).json({ error: 'Мод не найден' });
    await fsp.unlink(file);
    logActivity(req.srv, 'mod-delete', name);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

api.post('/servers/:sid/mods/upload', async (req, res, next) => {
  try {
    const name = String(req.query.name || '');
    if (!/^[^/\\]+\.jar$/i.test(name)) return res.status(400).json({ error: 'Имя должно оканчиваться на .jar' });
    const result = await handleUpload(req, modsDir(req.srv), name);
    logActivity(req.srv, 'mod-upload', name);
    const active = await isActive(req.srv);
    res.json({ ok: true, ...result, warning: active ? 'Перезапустите сервер, чтобы загрузить мод' : null });
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

// ---------------------------------------------------------------- backups

const jobs = new Map();

async function listBackups(srv) {
  const dir = path.join(srv.dir, 'backups');
  let names = [];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const m = name.match(BACKUP_RE);
    if (!m) continue;
    const st = lstatOrNull(path.join(dir, name));
    if (!st || !st.isFile()) continue;
    out.push({
      name,
      size: st.size,
      mtime: st.mtimeMs,
      scope: m[2],
      auto: Boolean(m[1]),
      stamp: m[3],
    });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

async function createBackup(srv, scope, auto) {
  if (!['world', 'config', 'full'].includes(scope)) throw bad(400, 'Неизвестный тип бэкапа');
  if (jobs.has(srv.id)) throw bad(409, 'Уже выполняется другая операция');
  jobs.set(srv.id, 'backup');
  const dir = path.join(srv.dir, 'backups');
  let dest = null;
  try {
    await fsp.mkdir(dir, { recursive: true });
    const name = `${auto ? 'auto-' : ''}${scope}-${timestamp()}.tar.gz`;
    dest = path.join(dir, name);

    const active = await isActive(srv);
    let rconOk = false;
    if (active) {
      try {
        await rconSend(srv, 'save-off');
        await rconSend(srv, 'save-all flush');
        rconOk = true;
      } catch {
        rconOk = false;
      }
      await sleep(1500);
    }

    try {
      const args = ['-czf', dest];
      if (scope === 'full') {
        args.push(
          '--exclude=./backups',
          '--exclude=./logs',
          '--exclude=./crash-reports',
          '--exclude=./libraries',
          '--exclude=./.cache',
          '--exclude=./.git',
        );
      }
      args.push('-C', srv.dir);
      if (scope === 'full') {
        args.push('.');
      } else {
        const want =
          scope === 'world' ? ['world', 'world_nether', 'world_the_end'] : ['config', 'defaultconfigs', 'kubejs', 'scripts', 'datapacks'];
        const existing = want.filter((d) => fs.existsSync(path.join(srv.dir, d)));
        if (!existing.length) throw bad(400, 'Нечего архивировать: нужные папки не найдены');
        args.push(...existing);
      }
      const r = await run('tar', args, 3600000);
      if (r.code !== 0) throw new Error('tar: ' + (r.stderr.trim() || r.stdout.trim() || 'ошибка архивации'));
    } finally {
      if (rconOk) {
        try {
          await rconSend(srv, 'save-on');
        } catch {
          /* ignore */
        }
      }
    }

    const st = await fsp.stat(dest);
    logActivity(srv, 'backup', `${auto ? 'авто-' : ''}${scope} · ${name}`);
    return { name, size: st.size, scope, auto: Boolean(auto) };
  } catch (e) {
    if (dest) await fsp.unlink(dest).catch(() => {});
    throw e;
  } finally {
    jobs.delete(srv.id);
  }
}

async function pruneAutoBackups(srv, keep) {
  const list = await listBackups(srv);
  const autos = list.filter((b) => b.auto);
  const dir = path.join(srv.dir, 'backups');
  for (const b of autos.slice(keep)) {
    await fsp.unlink(path.join(dir, b.name)).catch(() => {});
  }
}

api.get('/servers/:sid/backups', async (req, res, next) => {
  try {
    res.json({ backups: await listBackups(req.srv), busy: jobs.has(req.srv.id) });
  } catch (e) {
    next(e);
  }
});

api.post('/servers/:sid/backups', async (req, res, next) => {
  try {
    const scope = String((req.body && req.body.scope) || 'world');
    const result = await createBackup(req.srv, scope, false);
    res.json({ ok: true, backup: result });
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

api.post('/servers/:sid/backups/:name/restore', async (req, res, next) => {
  const srv = req.srv;
  const name = String(req.params.name || '');
  if (!BACKUP_RE.test(name)) return res.status(400).json({ error: 'Некорректное имя бэкапа' });
  if (jobs.has(srv.id)) return res.status(409).json({ error: 'Уже выполняется другая операция' });
  jobs.set(srv.id, 'restore');
  try {
    const file = path.join(srv.dir, 'backups', name);
    const st = lstatOrNull(file);
    if (!st || !st.isFile()) return res.status(404).json({ error: 'Бэкап не найден' });

    const scope = name.match(BACKUP_RE)[2];
    let stopped = false;
    let moved = [];
    if (await isActive(srv)) {
      await systemctl(srv, ['stop'], 60000);
      stopped = await waitInactive(srv, 120000);
      if (!stopped) return res.status(409).json({ error: 'Сервер не остановился за 120 секунд — восстановление отменено' });
    }

    if (scope === 'world') {
      const stamp = timestamp();
      for (const d of ['world', 'world_nether', 'world_the_end']) {
        const p = path.join(srv.dir, d);
        if (!fs.existsSync(p)) continue;
        const np = `${p}.before-restore-${stamp}`;
        await fsp.rename(p, np);
        moved.push(path.basename(np));
      }
    }

    const r = await run('tar', ['-xzf', file, '-C', srv.dir], 3600000);
    if (r.code !== 0) throw new Error('tar: ' + (r.stderr.trim() || 'ошибка распаковки'));

    logActivity(srv, 'restore', `${name}${moved.length ? ` · сохранено: ${moved.join(', ')}` : ''}`);
    res.json({
      ok: true,
      scope,
      stopped,
      moved,
      warning: 'Сервер не запущен автоматически. Запустите его вручную, когда будете готовы.',
    });
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  } finally {
    jobs.delete(srv.id);
  }
});

api.delete('/servers/:sid/backups/:name', async (req, res, next) => {
  try {
    const name = String(req.params.name || '');
    if (!BACKUP_RE.test(name)) return res.status(400).json({ error: 'Некорректное имя бэкапа' });
    const file = path.join(req.srv.dir, 'backups', name);
    const st = lstatOrNull(file);
    if (!st || !st.isFile()) return res.status(404).json({ error: 'Бэкап не найден' });
    await fsp.unlink(file);
    logActivity(req.srv, 'backup-delete', name);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

api.get('/servers/:sid/backups/:name/download', async (req, res, next) => {
  try {
    const name = String(req.params.name || '');
    if (!BACKUP_RE.test(name)) return res.status(400).json({ error: 'Некорректное имя бэкапа' });
    const file = path.join(req.srv.dir, 'backups', name);
    const st = lstatOrNull(file);
    if (!st || !st.isFile()) return res.status(404).json({ error: 'Бэкап не найден' });
    res.download(file, name);
  } catch (e) {
    next(e);
  }
});

api.get('/servers/:sid/backup-schedule', (req, res) => {
  res.json({ autobackup: req.srv.autobackup });
});

api.post('/servers/:sid/backup-schedule', (req, res) => {
  const b = (req.body && (req.body.autobackup || req.body)) || {};
  const srv = req.srv;
  const next = {
    enabled: Boolean(b.enabled),
    everyHours: Math.min(168, Math.max(1, Number(b.everyHours) || srv.autobackup.everyHours)),
    keep: Math.min(50, Math.max(1, Number(b.keep) || srv.autobackup.keep)),
    scope: ['world', 'config', 'full'].includes(b.scope) ? b.scope : srv.autobackup.scope,
  };
  srv.autobackup = next;
  saveServers();
  logActivity(srv, 'backup-schedule', `${next.enabled ? 'вкл' : 'выкл'} · каждые ${next.everyHours} ч · хранить ${next.keep}`);
  res.json({ autobackup: next });
});

// ---------------------------------------------------------------- settings

const SETTINGS_SPEC = [
  { key: 'motd', label: 'MOTD (сообщение в списке)', type: 'string', max: 256, default: 'Сервер Minecraft' },
  { key: 'server-port', label: 'Порт сервера', type: 'int', min: 1, max: 65535, default: 25565 },
  { key: 'max-players', label: 'Максимум игроков', type: 'int', min: 1, max: 200, default: 20 },
  { key: 'view-distance', label: 'Дальность прорисовки', type: 'int', min: 3, max: 32, default: 10 },
  { key: 'simulation-distance', label: 'Дальность симуляции', type: 'int', min: 3, max: 32, default: 10 },
  { key: 'spawn-protection', label: 'Защита спавна (блоки)', type: 'int', min: 0, max: 64, default: 16 },
  {
    key: 'difficulty',
    label: 'Сложность',
    type: 'enum',
    values: ['peaceful', 'easy', 'normal', 'hard'],
    default: 'normal',
  },
  {
    key: 'gamemode',
    label: 'Режим игры',
    type: 'enum',
    values: ['survival', 'creative', 'adventure', 'spectator'],
    default: 'survival',
  },
  { key: 'force-gamemode', label: 'Принудительный режим игры', type: 'bool', default: false },
  { key: 'hardcore', label: 'Хардкор', type: 'bool', default: false },
  { key: 'pvp', label: 'PvP', type: 'bool', default: true },
  { key: 'allow-flight', label: 'Полёт', type: 'bool', default: false },
  { key: 'allow-nether', label: 'Нижний мир', type: 'bool', default: true },
  { key: 'spawn-monsters', label: 'Монстры', type: 'bool', default: true },
  { key: 'spawn-animals', label: 'Животные', type: 'bool', default: true },
  { key: 'spawn-npcs', label: 'NPC', type: 'bool', default: true },
  { key: 'enable-command-block', label: 'Командные блоки', type: 'bool', default: false },
  { key: 'white-list', label: 'Белый список', type: 'bool', default: false },
  { key: 'online-mode', label: 'Online mode', type: 'bool', default: true },
  { key: 'enforce-secure-profile', label: 'Требовать подписанный профиль', type: 'bool', default: true },
  { key: 'player-idle-timeout', label: 'Кик за бездействие (мин)', type: 'int', min: 0, max: 1440, default: 0 },
];

function coerceSetting(spec, raw) {
  if (raw === undefined || raw === null || raw === '') return spec.default;
  if (spec.type === 'bool') return raw === true || String(raw) === 'true';
  if (spec.type === 'int') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : spec.default;
  }
  if (spec.type === 'enum') return spec.values.includes(String(raw)) ? String(raw) : spec.default;
  return String(raw);
}

function validateSetting(spec, value) {
  if (spec.type === 'bool') {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === 'false') return value === 'true';
    throw bad(400, `«${spec.label}»: ожидается да/нет`);
  }
  if (spec.type === 'int') {
    const n = Number(value);
    if (!Number.isInteger(n)) throw bad(400, `«${spec.label}»: нужно целое число`);
    if (n < spec.min || n > spec.max) throw bad(400, `«${spec.label}»: допустимо ${spec.min}–${spec.max}`);
    return n;
  }
  if (spec.type === 'enum') {
    const s = String(value);
    if (!spec.values.includes(s)) throw bad(400, `«${spec.label}»: недопустимое значение`);
    return s;
  }
  const s = String(value).replace(/[\r\n]+/g, ' ').trim();
  if (s.length > (spec.max || 256)) throw bad(400, `«${spec.label}»: слишком длинное значение`);
  return s;
}

function writeServerProperties(srv, updates) {
  const file = path.join(srv.dir, 'server.properties');
  let lines = [];
  try {
    lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  } catch {
    lines = [];
  }
  const seen = new Set();
  const out = lines.map((line) => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) return line;
    const key = m[1].trim();
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      seen.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) out.push(`${key}=${value}`);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  atomicWrite(file, out.join('\n') + '\n');
}

function parseMemory(value) {
  const m = String(value || '').match(/^(\d{1,4})([MG])$/);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === 'G' ? n * 1024 : n;
}

api.get('/servers/:sid/settings', (req, res) => {
  const srv = req.srv;
  const props = readProps(srv);
  const settings = {};
  for (const spec of SETTINGS_SPEC) settings[spec.key] = coerceSetting(spec, props[spec.key]);
  res.json({
    settings,
    spec: SETTINGS_SPEC,
    jvm: { min: srv.memory.min, max: srv.memory.max },
    restartRequired: true,
  });
});

api.post('/servers/:sid/settings', (req, res, next) => {
  try {
    const srv = req.srv;
    const b = req.body || {};
    const updates = {};
    const incoming = b.settings && typeof b.settings === 'object' ? b.settings : {};

    for (const [key, value] of Object.entries(incoming)) {
      const spec = SETTINGS_SPEC.find((s) => s.key === key);
      if (!spec) return res.status(400).json({ error: `Неизвестный параметр: ${key}` });
      const valid = validateSetting(spec, value);
      updates[key] = typeof valid === 'boolean' ? String(valid) : String(valid);
    }

    if (Object.keys(updates).length) writeServerProperties(srv, updates);

    if (b.jvm !== undefined) {
      const min = String((b.jvm && b.jvm.min) || '').trim();
      const max = String((b.jvm && b.jvm.max) || '').trim();
      const minMb = parseMemory(min);
      const maxMb = parseMemory(max);
      if (!minMb || !maxMb) return res.status(400).json({ error: 'Память JVM: формат вида 3G или 4096M' });
      if (minMb < 512 || minMb > 65536 || maxMb < 512 || maxMb > 65536) {
        return res.status(400).json({ error: 'Память JVM: допустимо от 512M до 65536M' });
      }
      if (minMb > maxMb) return res.status(400).json({ error: 'Минимум памяти не может быть больше максимума' });

      const script = path.join(srv.dir, 'start-server.sh');
      let content;
      try {
        content = fs.readFileSync(script, 'utf8');
      } catch {
        return res.status(400).json({ error: 'Файл start-server.sh не найден в папке сервера' });
      }
      let next = content.replace(/-Xms\d{1,4}[MG]/g, `-Xms${min}`).replace(/-Xmx\d{1,4}[MG]/g, `-Xmx${max}`);
      if (!/-Xms\d{1,4}[MG]/.test(next)) next = next.replace(/\bjava\b/, `java -Xms${min}`);
      if (!/-Xmx\d{1,4}[MG]/.test(next)) next = next.replace(/\bjava\b/, `java -Xmx${max}`);
      if (next !== content) atomicWrite(script, next);
      srv.memory = { min, max };
      saveServers();
    }

    logActivity(srv, 'settings', Object.keys(updates).join(', ') + (b.jvm !== undefined ? ' · JVM' : ''));
    res.json({ ok: true, restartRequired: true });
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

// ---------------------------------------------------------------- password

api.post('/password', (req, res) => {
  const b = req.body || {};
  const current = String(b.current || '');
  const next = String(b.next || '');
  if (!verifyPassword(current, passwordHash)) return res.status(401).json({ error: 'Текущий пароль неверный' });
  if (next.length < 6) return res.status(400).json({ error: 'Новый пароль: минимум 6 символов' });
  if (next.length > 128) return res.status(400).json({ error: 'Новый пароль слишком длинный' });
  passwordHash = hashPassword(next);
  fs.writeFileSync(PASSWORD_FILE, passwordHash, { mode: 0o600 });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- logs (SSE)

const logStreams = new Map();

function logPayload(line) {
  return `data: ${JSON.stringify({ line })}\n\n`;
}

function stopLogStream(sid) {
  const st = logStreams.get(sid);
  if (!st) return;
  logStreams.delete(sid);
  try {
    st.proc.kill('SIGTERM');
  } catch {
    /* ignore */
  }
}

function startLogProcess(srv, st) {
  const proc = spawn(
    'sudo',
    ['-n', '/usr/bin/journalctl', '-u', srv.unit, '-f', '-n', '0', '--no-pager', '-o', 'cat'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  st.proc = proc;
  let buf = '';
  proc.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    const parts = buf.split(/\r?\n/);
    buf = parts.pop();
    for (const line of parts) {
      if (line) st.lastLines.push(line);
      const payload = logPayload(line);
      for (const client of st.clients) {
        try {
          client.write(payload);
        } catch {
          /* ignore */
        }
      }
    }
    if (st.lastLines.length > 200) st.lastLines.splice(0, st.lastLines.length - 200);
  });
  proc.stderr.on('data', () => {});
  proc.on('error', () => {
    const payload = logPayload('панель: journalctl недоступен (проверьте sudo-права)');
    for (const client of st.clients) {
      try {
        client.write(payload);
      } catch {
        /* ignore */
      }
    }
  });
  proc.on('close', () => {
    const cur = logStreams.get(srv.id);
    if (cur === st) logStreams.delete(srv.id);
  });
}

api.get('/servers/:sid/logs/stream', async (req, res) => {
  const srv = req.srv;
  res.on('error', () => {});
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (res.flushHeaders) res.flushHeaders();
  res.write(': connected\n\n');

  const write = (chunk) => {
    if (res.writableEnded || res.destroyed) return;
    try {
      res.write(chunk);
    } catch {
      /* клиент ушёл */
    }
  };

  const history = await run(
    'sudo',
    ['-n', '/usr/bin/journalctl', '-u', srv.unit, '-n', '150', '--no-pager', '-o', 'cat'],
    15000,
  );
  if (history.code === 0) {
    for (const line of history.stdout.split(/\r?\n/)) {
      if (line) write(logPayload(line));
    }
  } else {
    write(logPayload('панель: не удалось прочитать журнал службы ' + srv.unit));
  }

  let st = logStreams.get(srv.id);
  if (!st) {
    st = { proc: null, clients: new Set(), lastLines: [] };
    logStreams.set(srv.id, st);
    startLogProcess(srv, st);
  }
  st.clients.add(res);

  const ping = setInterval(() => write(': ping\n\n'), 20000);
  if (ping.unref) ping.unref();

  const cleanup = () => {
    clearInterval(ping);
    st.clients.delete(res);
    if (!st.clients.size) stopLogStream(srv.id);
  };
  req.on('close', cleanup);
  req.on('aborted', cleanup);
});

api.get('/servers/:sid/logs/download', async (req, res, next) => {
  try {
    const srv = req.srv;
    const r = await run(
      'sudo',
      ['-n', '/usr/bin/journalctl', '-u', srv.unit, '-n', '5000', '--no-pager', '-o', 'short-iso'],
      45000,
    );
    const text = r.code === 0 ? r.stdout : r.stdout + (r.stderr ? `\n# ${r.stderr}` : '');
    res.attachment(`${srv.id}-log-${timestamp()}.txt`);
    res.type('text/plain; charset=utf-8');
    res.send(text || '# журнал пуст\n');
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- backup scheduler

async function autoBackupTick() {
  for (const srv of servers) {
    const cfg = srv.autobackup;
    if (!cfg || !cfg.enabled || jobs.has(srv.id)) continue;
    try {
      const list = await listBackups(srv);
      const autos = list.filter((b) => b.auto);
      const newest = autos.reduce((acc, b) => Math.max(acc, b.mtime), 0);
      const age = Date.now() - newest;
      if (!newest || age >= cfg.everyHours * 3600 * 1000) {
        await createBackup(srv, cfg.scope, true);
        await pruneAutoBackups(srv, cfg.keep);
      }
    } catch (e) {
      logActivity(srv, 'backup-error', String((e && e.message) || e));
    }
  }
}

const scheduleTimer = setInterval(() => {
  autoBackupTick().catch(() => {});
}, 10 * 60 * 1000);
if (scheduleTimer.unref) scheduleTimer.unref();
const firstTick = setTimeout(() => {
  autoBackupTick().catch(() => {});
}, 60000);
if (firstTick.unref) firstTick.unref();

// ---------------------------------------------------------------- static + errors

app.use('/api', api);

app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  return res.status(404).json({ error: 'Не найдено' });
});

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Не найдено' });
  return res.status(404).send('Не найдено');
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = Number(err && err.status) || (err && err.type === 'entity.too.large' ? 413 : 500);
  const message = status >= 500 ? 'Внутренняя ошибка: ' + String((err && err.message) || err) : String(err.message || err);
  if (status >= 500) console.error('[panel]', err);
  if (res.headersSent) {
    try {
      res.end();
    } catch {
      /* ignore */
    }
    return;
  }
  res.status(status).json({ error: message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[mcpanel] http://0.0.0.0:${PORT} · серверов: ${servers.length}`);
});

