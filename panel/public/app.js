'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const SID_KEY = 'mcpanel.sid';

const VIEW_META = {
  desk: { title: 'Рабочий стол', sub: 'Все серверы на этой машине' },
  overview: { title: 'Обзор', sub: '' },
  console: { title: 'Консоль', sub: '' },
  players: { title: 'Игроки', sub: '' },
  files: { title: 'Файлы', sub: '' },
  mods: { title: 'Моды', sub: '' },
  backups: { title: 'Бэкапы', sub: '' },
  settings: { title: 'Настройки', sub: '' },
};

const ACTION_LABELS = {
  start: 'Запуск',
  stop: 'Остановка',
  restart: 'Перезапуск',
  kill: 'Завершение',
  backup: 'Бэкап',
  'backup-error': 'Ошибка бэкапа',
  'backup-delete': 'Бэкап удалён',
  'backup-schedule': 'Расписание',
  restore: 'Восстановление',
  'mod-toggle': 'Мод',
  'mod-delete': 'Удаление мода',
  'mod-upload': 'Загрузка мода',
  'file-upload': 'Загрузка файла',
  'file-write': 'Правка файла',
  'file-delete': 'Удаление файла',
  'file-rename': 'Переименование',
  'file-mkdir': 'Новая папка',
  settings: 'Настройки',
  command: 'Команда',
  'access-whitelist': 'Whitelist',
  'access-ops': 'Операторы',
  'access-banned': 'Баны',
  'server-add': 'Сервер добавлен',
  'server-edit': 'Сервер изменён',
  'server-remove': 'Сервер убран',
};

const state = {
  brand: { name: 'MCPanel', tagline: 'панель серверов' },
  servers: [],
  sid: null,
  view: 'desk',
  overview: null,
  status: null,
  es: null,
  esSid: null,
  filesPath: '',
  mods: [],
  modFilter: '',
  backups: [],
  settings: null,
  consoleLines: 0,
  booted: false,
};

let pollTimer = null;

// ------------------------------------------------------------------ утилиты

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function toast(message, type = 'ok') {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .25s';
    setTimeout(() => el.remove(), 260);
  }, 4200);
}

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} Б`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} КБ`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} МБ`;
  return `${(n / 1024 ** 3).toFixed(2)} ГБ`;
}

function fmtMb(kb) {
  if (!kb) return '0 МБ';
  return `${Math.round(kb / 1024)} МБ`;
}

function fmtGb(bytes) {
  return `${((Number(bytes) || 0) / 1024 ** 3).toFixed(1)} ГБ`;
}

function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtShortDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtUptime(seconds) {
  const s = Number(seconds) || 0;
  if (!s) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d} д ${h} ч`;
  if (h) return `${h} ч ${String(m).padStart(2, '0')} мин`;
  return `${m} мин`;
}

function pct(part, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((part / total) * 100)));
}

function hue(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function currentServer() {
  return state.servers.find((s) => s.id === state.sid) || null;
}

async function api(path, options = {}) {
  const opts = { ...options, headers: { ...(options.headers || {}) } };
  if (opts.body && typeof opts.body !== 'string' && !(opts.body instanceof Blob) && !(opts.body instanceof File)) {
    opts.body = JSON.stringify(opts.body);
    opts.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, opts);
  if (res.status === 401) {
    showLogin();
    throw new Error('Нужно войти заново');
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `HTTP ${res.status}`);
  }
  return data;
}

// ------------------------------------------------------------------ модалки

let modalOnClose = null;

function closeModal() {
  const root = $('#modalRoot');
  if (root.classList.contains('hidden')) return;
  root.classList.add('hidden');
  $('#modalBody').innerHTML = '';
  $('#modalFoot').innerHTML = '';
  const fn = modalOnClose;
  modalOnClose = null;
  if (fn) fn();
}

function openModal({ title, body, actions = [], wide = false, onClose = null }) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = '';
  if (typeof body === 'string') $('#modalBody').innerHTML = body;
  else if (body) $('#modalBody').appendChild(body);

  const foot = $('#modalFoot');
  foot.innerHTML = '';
  const handle = { close: closeModal, body: $('#modalBody') };
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn ${action.kind || 'ghost'}`;
    btn.textContent = action.label;
    btn.addEventListener('click', () => action.onClick && action.onClick(handle));
    foot.appendChild(btn);
  }

  modalOnClose = onClose;
  $('#modalRoot').classList.remove('hidden');
  $('#modalRoot').querySelector('.modal-card').style.width = wide ? 'min(720px, 100%)' : '';
  return handle;
}

function confirmDialog(message, options = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const handle = openModal({
      title: options.title || 'Подтверждение',
      body: `<p>${escapeHtml(message)}</p>`,
      actions: [
        {
          label: options.cancelLabel || 'Отмена',
          kind: 'ghost',
          onClick: () => {
            finish(false);
            handle.close();
          },
        },
        {
          label: options.okLabel || 'Подтвердить',
          kind: options.danger === false ? 'primary' : 'danger',
          onClick: () => {
            finish(true);
            handle.close();
          },
        },
      ],
      onClose: () => finish(false),
    });
  });
}

function promptDialog(title, options = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <label class="field">
        <span>${escapeHtml(options.label || 'Значение')}</span>
        <input type="text" id="promptValue" value="${escapeHtml(options.value || '')}" placeholder="${escapeHtml(options.placeholder || '')}">
      </label>`;
    const handle = openModal({
      title,
      body: wrap,
      actions: [
        {
          label: 'Отмена',
          kind: 'ghost',
          onClick: () => {
            finish(null);
            handle.close();
          },
        },
        {
          label: options.okLabel || 'Сохранить',
          kind: 'primary',
          onClick: () => {
            const input = wrap.querySelector('#promptValue');
            const value = input ? input.value.trim() : '';
            if (!value) {
              toast('Пустое значение', 'err');
              return;
            }
            finish(value);
            handle.close();
          },
        },
      ],
      onClose: () => finish(null),
    });
    setTimeout(() => {
      const input = wrap.querySelector('#promptValue');
      if (input) {
        input.focus();
        input.select();
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const value = input.value.trim();
            if (!value) return;
            finish(value);
            handle.close();
          }
        });
      }
    }, 40);
  });
}

$('#modalRoot').addEventListener('click', (e) => {
  if (e.target.closest('[data-modal-close]')) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// ------------------------------------------------------------------ вход

function showLogin() {
  closeModal();
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  setTimeout(() => $('#loginPassword').focus(), 50);
}

function showApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginError').textContent = '';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('#loginPassword').value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      $('#loginError').textContent = data.error || 'Ошибка входа';
      return;
    }
    $('#loginPassword').value = '';
    showApp();
    await start();
  } catch {
    $('#loginError').textContent = 'Сеть недоступна';
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch {
    /* ignore */
  }
  if (state.es) state.es.close();
  location.reload();
});

async function boot() {
  try {
    const res = await fetch('/api/overview');
    if (res.status === 401) {
      showLogin();
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.brand = data.brand || state.brand;
    showApp();
    await start();
  } catch {
    showLogin();
  }
}

async function start() {
  if (!state.booted) {
    state.booted = true;
    state.sid = localStorage.getItem(SID_KEY) || null;
  }
  $('#brandName').textContent = state.brand.name || 'MCPanel';
  $('#brandTagline').textContent = state.brand.tagline || 'панель серверов';
  await loadServers();
  updateNavLock();
  connectLogs();
  await navigate('desk');
  if (state.sid) refreshSideStatus();
}

// ------------------------------------------------------------------ серверы

async function loadServers() {
  const data = await api('/api/servers');
  state.servers = data.servers || [];
  if (state.sid && !state.servers.some((s) => s.id === state.sid)) state.sid = null;
  if (!state.sid && state.servers.length && state.booted) {
    const saved = localStorage.getItem(SID_KEY);
    if (saved && state.servers.some((s) => s.id === saved)) state.sid = saved;
  }
  renderServerSelect();
}

function renderServerSelect() {
  const select = $('#serverSelect');
  const current = state.sid || '';
  select.innerHTML = '<option value="">— не выбран —</option>' + state.servers
    .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.icon)} ${escapeHtml(s.name)}</option>`)
    .join('');
  select.value = current;
  updateNavLock();
}

function updateNavLock() {
  $$('.nav-item').forEach((btn) => {
    const locked = btn.dataset.view !== 'desk' && !state.sid;
    btn.classList.toggle('locked', locked);
  });
}

$('#serverSelect').addEventListener('change', async (e) => {
  await selectServer(e.target.value || null);
});

async function selectServer(id) {
  state.sid = id || null;
  state.status = null;
  state.filesPath = '';
  state.mods = [];
  state.backups = [];
  state.consoleLines = 0;
  $('#console').innerHTML = '';
  $('#miniLog').innerHTML = '';
  if (id) localStorage.setItem(SID_KEY, id);
  else localStorage.removeItem(SID_KEY);
  $('#serverSelect').value = id || '';
  updateNavLock();
  connectLogs();
  if (!id) {
    await navigate('desk');
  } else if (state.view === 'desk') {
    await navigate('overview');
  } else {
    await navigate(state.view);
  }
  refreshSideStatus();
}

// ------------------------------------------------------------------ навигация

async function navigate(view) {
  if (view !== 'desk' && !state.sid) {
    toast('Сначала выберите сервер', 'err');
    view = 'desk';
  }
  const meta = VIEW_META[view] || VIEW_META.desk;
  state.view = view;
  clearPoll();

  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${view}`));

  const srv = currentServer();
  $('#viewTitle').textContent = meta.title;
  if (view === 'desk' || !srv) {
    $('#viewSub').textContent = meta.sub || 'Все серверы на этой машине';
  } else {
    $('#viewSub').textContent = `${srv.name} · ${srv.dir}`;
  }
  renderTopActions();

  try {
    if (view === 'desk') {
      await loadOverview();
      pollTimer = setInterval(loadOverview, 5000);
    } else if (view === 'overview') {
      await loadStatusView();
      pollTimer = setInterval(loadStatusView, 5000);
    } else if (view === 'console') {
      $('#downloadLog').href = `/api/servers/${encodeURIComponent(state.sid)}/logs/download`;
      scrollConsole();
      $('#command').focus();
    } else if (view === 'players') {
      await loadPlayers();
      await loadAccess();
    } else if (view === 'files') {
      await loadFiles(state.filesPath);
    } else if (view === 'mods') {
      await loadMods();
    } else if (view === 'backups') {
      await loadBackups();
      await loadSchedule();
    } else if (view === 'settings') {
      await loadSettings();
    }
  } catch (e) {
    if (e.message !== 'Нужно войти заново') toast(e.message, 'err');
  }
}

function clearPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

$$('.nav-item').forEach((btn) => btn.addEventListener('click', () => navigate(btn.dataset.view)));
$$('[data-goto]').forEach((btn) => btn.addEventListener('click', () => navigate(btn.dataset.goto)));

// ------------------------------------------------------------------ верхние кнопки

function renderTopActions() {
  const box = $('#topActions');
  if (!state.sid || state.view === 'desk') {
    box.innerHTML = '';
    return;
  }
  const st = state.status;
  const active = st ? Boolean(st.active) : null;
  const disabled = (what) => {
    if (active === null) return ' disabled';
    if (what === 'start') return active ? ' disabled' : '';
    return active ? '' : ' disabled';
  };
  box.innerHTML = `
    <button class="btn success" data-top="start"${disabled('start')}>▶ Запустить</button>
    <button class="btn ghost" data-top="restart"${disabled('restart')}>⟳ Перезапустить</button>
    <button class="btn danger" data-top="stop"${disabled('stop')}>■ Остановить</button>`;
}

$('#topActions').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-top]');
  if (!btn) return;
  serverAction(btn.dataset.top);
});

async function serverAction(action) {
  if (!state.sid) return;
  if (action === 'stop' && !(await confirmDialog('Остановить сервер? Игроки будут отключены.', { okLabel: 'Остановить' }))) return;
  if (action === 'restart' && !(await confirmDialog('Перезапустить сервер?', { okLabel: 'Перезапустить', danger: false }))) return;
  const labels = {
    start: 'Сервер запускается… первый запуск занимает 3–5 минут.',
    stop: 'Сервер останавливается…',
    restart: 'Перезапуск сервера…',
    kill: 'Процесс завершён принудительно.',
  };
  try {
    await api(`/api/servers/${encodeURIComponent(state.sid)}/action`, { method: 'POST', body: { action } });
    toast(labels[action] || 'Готово');
    setTimeout(refreshCurrent, 1500);
    setTimeout(refreshSideStatus, 1800);
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function refreshCurrent() {
  if (state.view === 'desk') await loadOverview().catch(() => {});
  else if (state.view === 'overview') await loadStatusView().catch(() => {});
  else await refreshSideStatus();
}

async function refreshSideStatus() {
  if (!state.sid) {
    setSide(null);
    return;
  }
  try {
    const st = await api(`/api/servers/${encodeURIComponent(state.sid)}/status`);
    state.status = st;
    setSide(st);
    if (state.view !== 'desk') renderTopActions();
  } catch {
    setSide(null);
  }
}

function setSide(st) {
  const dot = $('#sideDot');
  const label = $('#sideState');
  if (!state.sid) {
    dot.className = 'dot off';
    label.textContent = 'нет сервера';
    return;
  }
  if (!st) {
    dot.className = 'dot off';
    label.textContent = 'проверка…';
    return;
  }
  dot.className = `dot ${st.active ? 'on' : 'off'}`;
  label.textContent = st.active ? 'сервер работает' : 'сервер остановлен';
}

// ------------------------------------------------------------------ рабочий стол

async function loadOverview() {
  const data = await api('/api/overview');
  state.overview = data;
  if (data.brand) state.brand = data.brand;
  renderHost(data.host);
  renderServerCards(data.servers || []);
  $('#serversHint').textContent = data.configError
    ? `Ошибка конфига: ${data.configError}`
    : `${(data.servers || []).length} сервер(ов) в панели`;
}

function renderHost(host) {
  if (!host) return;
  const memUsed = host.mem.total - host.mem.free;
  const disk = host.disk || { total: 0, free: 0, used: 0 };
  const item = (label, value) => `
    <div class="host-item">
      <span class="host-label">${escapeHtml(label)}</span>
      <span class="host-value">${escapeHtml(value)}</span>
    </div>`;
  $('#hostStats').innerHTML = [
    item('адрес', host.address),
    item('нагрузка', (host.load || []).join(' / ')),
    item('память', `${fmtGb(memUsed)} / ${fmtGb(host.mem.total)} · ${pct(memUsed, host.mem.total)}%`),
    item('диск', disk.total ? `${fmtGb(disk.used)} / ${fmtGb(disk.total)} · ${pct(disk.used, disk.total)}%` : '—'),
    item('аптайм', fmtUptime(host.uptime)),
    item('система', host.hostname || '—'),
  ].join('');
}

function renderServerCards(servers) {
  const box = $('#serverCards');
  if (!servers.length) {
    box.innerHTML = '<div class="card"><div class="empty">Пока нет серверов. Нажмите «+ Добавить сервер».</div></div>';
    return;
  }
  box.innerHTML = servers.map((srv) => {
    const badge = srv.active
      ? '<span class="badge on">● работает</span>'
      : '<span class="badge off">● остановлен</span>';
    return `
      <article class="server-card">
        <div class="sc-top">
          <div class="sc-icon">${escapeHtml(srv.icon || '🎮')}</div>
          <div class="sc-title">
            <div class="sc-name">${escapeHtml(srv.name)}</div>
            <div class="sc-desc">${escapeHtml(srv.description || 'без описания')}</div>
          </div>
          ${badge}
        </div>
        <div class="sc-meta">
          <div><b>${srv.players ? `${srv.players.online}/${srv.players.max}` : '—'}</b><small>игроки</small></div>
          <div><b>${Number(srv.mods) || 0}</b><small>моды</small></div>
          <div><b>${escapeHtml(srv.address || '—')}:${escapeHtml(srv.port)}</b><small>адрес</small></div>
        </div>
        <div class="sc-foot">
          <button class="btn tiny primary" type="button" data-open-server="${escapeHtml(srv.id)}">Открыть</button>
          <button class="btn tiny success" type="button" data-card-action="${escapeHtml(srv.id)}:start"${srv.active ? ' disabled' : ''}>▶ Запустить</button>
          <button class="btn tiny danger" type="button" data-card-action="${escapeHtml(srv.id)}:stop"${srv.active ? '' : ' disabled'}>■ Остановить</button>
        </div>
      </article>`;
  }).join('');
}

$('#serverCards').addEventListener('click', async (e) => {
  const open = e.target.closest('[data-open-server]');
  if (open) {
    await selectServer(open.dataset.openServer);
    return;
  }
  const act = e.target.closest('[data-card-action]');
  if (!act) return;
  const [id, action] = act.dataset.cardAction.split(':');
  if (action === 'stop' && !(await confirmDialog('Остановить сервер? Игроки будут отключены.', { okLabel: 'Остановить' }))) return;
  try {
    await api(`/api/servers/${encodeURIComponent(id)}/action`, { method: 'POST', body: { action } });
    toast(action === 'start' ? 'Сервер запускается…' : 'Сервер останавливается…');
    setTimeout(loadOverview, 1500);
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('#addServerBtn').addEventListener('click', openAddServer);

function openAddServer() {
  const wrap = document.createElement('div');
  wrap.className = 'modal-form';
  wrap.innerHTML = `
    <label class="field full"><span>Название</span><input type="text" name="name" placeholder="Например, SkyFactory 5"></label>
    <label class="field full"><span>Описание</span><input type="text" name="description" placeholder="Коротко о сборке"></label>
    <label class="field"><span>Иконка (эмодзи)</span><input type="text" name="icon" value="🎮" maxlength="4"></label>
    <label class="field"><span>Имя службы systemd (unit)</span><input type="text" name="unit" placeholder="mc-skyfactory"></label>
    <label class="field full"><span>Папка сервера (абсолютный путь)</span><input type="text" name="dir" placeholder="/home/server/skyfactory"></label>
    <label class="field"><span>Игровой порт</span><input type="number" name="gamePort" value="25565" min="1" max="65535"></label>
    <label class="field"><span>RCON-порт</span><input type="number" name="rconPort" value="25575" min="1" max="65535"></label>
    <label class="field"><span>Пароль RCON</span><input type="text" name="rconPassword" placeholder="из server.properties"></label>
    <label class="field"><span>Версия Minecraft</span><input type="text" name="mcVersion" value="1.21.1"></label>
    <label class="field"><span>Загрузчик</span><input type="text" name="loader" value="NeoForge"></label>`;

  const m = openModal({
    title: 'Добавить сервер',
    body: wrap,
    wide: true,
    actions: [
      { label: 'Отмена', kind: 'ghost', onClick: () => m.close() },
      {
        label: 'Добавить',
        kind: 'primary',
        onClick: async () => {
          const val = (n) => {
            const el = wrap.querySelector(`[name="${n}"]`);
            return el ? el.value.trim() : '';
          };
          const payload = {
            name: val('name'),
            description: val('description'),
            icon: val('icon') || '🎮',
            unit: val('unit'),
            dir: val('dir'),
            gamePort: Number(val('gamePort')) || 25565,
            rconPort: Number(val('rconPort')) || 25575,
            rconPassword: val('rconPassword'),
            mcVersion: val('mcVersion') || '1.21.1',
            loader: val('loader') || 'NeoForge',
          };
          if (!payload.name) return toast('Укажите название', 'err');
          if (!payload.dir.startsWith('/')) return toast('Путь должен быть абсолютным', 'err');
          try {
            const res = await api('/api/servers', { method: 'POST', body: payload });
            m.close();
            toast(res.warning ? `Сервер добавлен. ${res.warning}` : 'Сервер добавлен');
            await loadServers();
            await loadOverview();
          } catch (err) {
            toast(err.message, 'err');
          }
        },
      },
    ],
  });
}

// ------------------------------------------------------------------ обзор

async function loadStatusView() {
  if (!state.sid) return;
  const st = await api(`/api/servers/${encodeURIComponent(state.sid)}/status`);
  state.status = st;
  renderOverviewStats(st);
  renderTopActions();
  setSide(st);
  await loadActivity();
}

function statCard(label, value, sub, cls = '') {
  return `
    <div class="card stat">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value ${cls}">${escapeHtml(value)}</div>
      <div class="stat-sub">${escapeHtml(sub)}</div>
    </div>`;
}

function renderOverviewStats(st) {
  const hostMemUsed = st.memTotal - st.memFree;
  const players = st.players
    ? `${st.players.online} / ${st.players.max}`
    : st.active ? '—' : '0';
  const playersSub = st.players && st.players.names.length
    ? st.players.names.join(', ')
    : st.active ? 'RCON ещё не готов' : 'сервер выключен';

  $('#overviewStats').innerHTML = [
    statCard('Состояние', st.active ? 'Работает' : 'Остановлен', st.enabled ? 'автозапуск включён' : 'автозапуск выключен', st.active ? 'on' : 'off'),
    statCard('Игроки', players, playersSub),
    statCard('Память сервера', fmtMb(st.rssKb), `система: ${fmtGb(hostMemUsed)} / ${fmtGb(st.memTotal)}`),
    statCard('Аптайм', fmtUptime(st.uptime), 'с момента запуска'),
    statCard('Версия', st.mcVersion || '—', `${st.loader || ''} ${st.neoforge || ''} · ${st.mods} модов`.trim()),
    statCard('Адрес', `${st.address}:${st.port}`, `мир: ${fmtSize(st.worldSize)}`, 'small'),
  ].join('');
}

async function loadActivity() {
  try {
    const data = await api(`/api/activity?sid=${encodeURIComponent(state.sid || '')}&limit=12`);
    renderActivity(data.entries || []);
  } catch {
    /* ignore */
  }
}

function renderActivity(entries) {
  const box = $('#activityList');
  if (!entries.length) {
    box.innerHTML = '<div class="empty">Пока пусто</div>';
    return;
  }
  box.innerHTML = entries.map((e) => `
    <div class="activity-row">
      <span class="activity-time">${escapeHtml(fmtShortDate(e.ts))}</span>
      <span class="activity-act">${escapeHtml(ACTION_LABELS[e.action] || e.action)}</span>
      <span class="activity-detail">${escapeHtml(e.detail || '')}</span>
    </div>`).join('');
}

$('#quickActions').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-quick]');
  if (!btn) return;
  const quick = btn.dataset.quick;
  if (quick === 'backup') {
    await navigate('backups');
    createBackup('world');
  } else if (quick === 'files' || quick === 'mods') {
    await navigate(quick);
  } else if (quick === 'restart') {
    await serverAction('restart');
  }
});

// ------------------------------------------------------------------ консоль / журнал

function classify(line) {
  if (/\/ERROR\]|\bERROR\b|Exception|Caused by|Failed to start/.test(line)) return 't-error';
  if (/\/WARN\]|\bWARN\b|WARNING/.test(line)) return 't-warn';
  if (/Done \(|For help, type|Starting minecraft server/.test(line)) return 't-done';
  if (/^> /.test(line)) return 't-cmd';
  if (/\/INFO\]|\bINFO\b/.test(line)) return 't-info';
  return '';
}

function appendConsole(line) {
  const body = $('#console');
  if (body) {
    const span = document.createElement('span');
    span.className = `line ${classify(line)}`;
    span.textContent = line;
    const stick = $('#autoscroll') ? $('#autoscroll').checked : true;
    body.appendChild(span);
    state.consoleLines += 1;
    if (state.consoleLines > 2500) {
      for (let i = 0; i < 500; i += 1) {
        if (body.firstChild) body.removeChild(body.firstChild);
      }
      state.consoleLines -= 500;
    }
    if (stick) body.scrollTop = body.scrollHeight;
  }

  const mini = $('#miniLog');
  if (mini) {
    const span = document.createElement('span');
    span.className = `line ${classify(line)}`;
    span.textContent = `${line}\n`;
    mini.appendChild(span);
    while (mini.childNodes.length > 40) mini.removeChild(mini.firstChild);
    mini.scrollTop = mini.scrollHeight;
  }
}

function scrollConsole() {
  const body = $('#console');
  if (body) body.scrollTop = body.scrollHeight;
}

function connectLogs() {
  if (state.es) {
    state.es.close();
    state.es = null;
  }
  state.esSid = null;
  if (!state.sid) return;
  const sid = state.sid;
  const es = new EventSource(`/api/servers/${encodeURIComponent(sid)}/logs/stream`);
  state.es = es;
  state.esSid = sid;
  es.onmessage = (e) => {
    if (state.esSid !== sid) return;
    try {
      const data = JSON.parse(e.data);
      if (data && typeof data.line === 'string') appendConsole(data.line);
    } catch {
      /* ignore */
    }
  };
  es.onerror = () => {
    fetch('/api/servers').then((r) => {
      if (r.status === 401) {
        es.close();
        showLogin();
      }
    }).catch(() => {});
  };
}

$('#clearLog').addEventListener('click', () => {
  $('#console').innerHTML = '';
  state.consoleLines = 0;
});

$('#commandForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#command');
  const cmd = input.value.trim();
  if (!cmd || !state.sid) return;
  input.value = '';
  appendConsole(`> ${cmd}`);
  try {
    const data = await api(`/api/servers/${encodeURIComponent(state.sid)}/command`, {
      method: 'POST',
      body: { command: cmd },
    });
    if (data && data.output) {
      for (const line of String(data.output).split('\n')) appendConsole(line);
    }
  } catch (err) {
    toast(err.message, 'err');
  }
});

// ------------------------------------------------------------------ игроки

async function loadPlayers() {
  if (!state.sid) return;
  const data = await api(`/api/servers/${encodeURIComponent(state.sid)}/players`);
  renderOnlinePlayers(data);
}

function renderOnlinePlayers(data) {
  const box = $('#onlinePlayers');
  const count = $('#playerCount');
  if (!data.ok) {
    count.textContent = data.online ? `${data.online}` : '—';
    box.innerHTML = `<div class="empty">${escapeHtml(data.error || 'Нет данных')}</div>`;
    return;
  }
  count.textContent = `${data.online} / ${data.max}`;
  if (!data.names.length) {
    box.innerHTML = '<div class="empty">На сервере пока никого нет</div>';
    return;
  }
  box.innerHTML = data.names.map((name) => {
    const h = hue(name);
    return `
      <div class="player">
        <div class="avatar" style="background: linear-gradient(135deg, hsl(${h} 75% 62%), hsl(${(h + 40) % 360} 75% 55%))">${escapeHtml(name.slice(0, 1).toUpperCase())}</div>
        <div class="player-main">
          <div class="player-name">${escapeHtml(name)}</div>
          <div class="player-sub">в сети</div>
        </div>
        <div class="player-actions">
          <button class="btn tiny ghost" type="button" data-player="kick:${escapeHtml(name)}" title="Кикнуть">kick</button>
          <button class="btn tiny ghost" type="button" data-player="ops:add:${escapeHtml(name)}" title="Выдать OP">op</button>
          <button class="btn tiny ghost" type="button" data-player="ops:remove:${escapeHtml(name)}" title="Снять OP">deop</button>
          <button class="btn tiny danger" type="button" data-player="banned:add:${escapeHtml(name)}" title="Забанить">ban</button>
        </div>
      </div>`;
  }).join('');
}

$('#onlinePlayers').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-player]');
  if (!btn) return;
  const parts = btn.dataset.player.split(':');
  const action = parts[0];
  if (action === 'kick') {
    const name = parts[1];
    if (!(await confirmDialog(`Кикнуть игрока ${name}?`, { okLabel: 'Кикнуть' }))) return;
    try {
      await api(`/api/servers/${encodeURIComponent(state.sid)}/command`, {
        method: 'POST',
        body: { command: `kick ${name}` },
      });
      toast(`Игрок ${name} отключён`);
      setTimeout(loadPlayers, 600);
    } catch (err) {
      toast(err.message, 'err');
    }
    return;
  }
  const list = parts[0];
  const op = parts[1];
  const name = parts[2];
  await changeAccess(list, op, name);
});

async function loadAccess() {
  if (!state.sid) return;
  const data = await api(`/api/servers/${encodeURIComponent(state.sid)}/access`);
  renderAccess(data);
}

function renderAccess(data) {
  const render = (list, items, emptyText) => {
    if (!items.length) return `<div class="empty">${emptyText}</div>`;
    return items.map((item) => `
      <div class="access-row">
        <div style="min-width:0">
          <div class="name">${escapeHtml(item.name)}</div>
          <div class="uuid">${escapeHtml(item.uuid || '')}</div>
        </div>
        <button class="btn tiny danger" type="button" data-access="remove:${list}:${escapeHtml(item.name)}">Убрать</button>
      </div>`).join('');
  };

  $('#whitelistList').innerHTML = render('whitelist', data.whitelist || [], 'Белый список пуст');
  $('#opsList').innerHTML = render('ops', data.ops || [], 'Операторов нет');
  $('#bannedList').innerHTML = render('banned', data.banned || [], 'Бан-лист пуст');
  $('#wlCount').textContent = String((data.whitelist || []).length);
  $('#opCount').textContent = String((data.ops || []).length);
  $('#banCount').textContent = String((data.banned || []).length);
}

async function changeAccess(list, action, name) {
  const labels = { whitelist: 'белый список', ops: 'операторов', banned: 'бан-лист' };
  const verb = action === 'add' ? 'Добавить' : 'Убрать';
  if (action === 'remove' && !(await confirmDialog(`Убрать ${name} из ${labels[list]}?`, { okLabel: 'Убрать' }))) return;
  try {
    const data = await api(`/api/servers/${encodeURIComponent(state.sid)}/access`, {
      method: 'POST',
      body: { list, action, name },
    });
    renderAccess(data);
    toast(`${verb}: ${name}`);
    if (state.view === 'players') loadPlayers().catch(() => {});
  } catch (err) {
    toast(err.message, 'err');
  }
}

$$('[data-access-form]').forEach((form) => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const list = form.dataset.accessForm;
    const name = form.elements.name.value.trim();
    if (!name) return;
    form.elements.name.value = '';
    await changeAccess(list, 'add', name);
  });
});

$('#whitelistList').addEventListener('click', onAccessRemove);
$('#opsList').addEventListener('click', onAccessRemove);
$('#bannedList').addEventListener('click', onAccessRemove);

function onAccessRemove(e) {
  const btn = e.target.closest('[data-access]');
  if (!btn) return;
  const parts = btn.dataset.access.split(':');
  changeAccess(parts[1], parts[0], parts.slice(2).join(':'));
}

// ------------------------------------------------------------------ файлы

async function loadFiles(rel) {
  if (!state.sid) return;
  const data = await api(`/api/servers/${encodeURIComponent(state.sid)}/files?path=${encodeURIComponent(rel || '')}`);
  state.filesPath = data.path || '';
  renderCrumbs(state.filesPath);
  renderFileRows(data.entries || []);
  $('#filesUp').disabled = !state.filesPath;
}

function renderCrumbs(rel) {
  const box = $('#crumbs');
  const parts = rel ? rel.split('/') : [];
  const bits = ['<button class="crumb" type="button" data-crumb="">корень</button>'];
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    bits.push('<span class="crumb-sep">/</span>');
    bits.push(`<button class="crumb" type="button" data-crumb="${escapeHtml(acc)}">${escapeHtml(part)}</button>`);
  }
  box.innerHTML = bits.join('');
}

function renderFileRows(entries) {
  const body = $('#filesBody');
  if (!entries.length) {
    body.innerHTML = '<tr><td colspan="4" class="empty">Папка пуста</td></tr>';
    return;
  }
  body.innerHTML = entries.map((entry) => {
    const icon = entry.dir ? '📁' : fileIcon(entry.name);
    const size = entry.dir ? '—' : fmtSize(entry.size);
    const actions = entry.dir
      ? `
        <button class="btn tiny ghost" type="button" data-file="rename" data-path="${escapeHtml(entry.path)}" data-name="${escapeHtml(entry.name)}">Переименовать</button>
        <button class="btn tiny danger" type="button" data-file="delete" data-path="${escapeHtml(entry.path)}" data-name="${escapeHtml(entry.name)}">Удалить</button>`
      : `
        <button class="btn tiny ghost" type="button" data-file="edit" data-path="${escapeHtml(entry.path)}" data-name="${escapeHtml(entry.name)}">Изменить</button>
        <button class="btn tiny ghost" type="button" data-file="download" data-path="${escapeHtml(entry.path)}">Скачать</button>
        <button class="btn tiny ghost" type="button" data-file="rename" data-path="${escapeHtml(entry.path)}" data-name="${escapeHtml(entry.name)}">Переименовать</button>
        <button class="btn tiny danger" type="button" data-file="delete" data-path="${escapeHtml(entry.path)}" data-name="${escapeHtml(entry.name)}">Удалить</button>`;
    return `
      <tr>
        <td>
          <button class="file-name" type="button" data-file="${entry.dir ? 'open' : 'edit'}" data-path="${escapeHtml(entry.path)}" data-name="${escapeHtml(entry.name)}">
            <span class="file-icon">${icon}</span><span>${escapeHtml(entry.name)}</span>
          </button>
        </td>
        <td class="col-size">${escapeHtml(size)}</td>
        <td class="col-date">${escapeHtml(fmtDate(entry.mtime))}</td>
        <td class="col-actions">${actions}</td>
      </tr>`;
  }).join('');
}

function fileIcon(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  if (['jar', 'zip', 'gz', 'tar'].includes(ext)) return '📦';
  if (['json', 'yml', 'yaml', 'toml', 'cfg', 'conf', 'properties', 'txt', 'md', 'log', 'sh'].includes(ext)) return '📄';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return '🖼';
  return '📄';
}

$('#filesBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-file]');
  if (!btn) return;
  const action = btn.dataset.file;
  const rel = btn.dataset.path || '';
  const name = btn.dataset.name || '';
  if (action === 'open') {
    await loadFiles(rel);
  } else if (action === 'edit') {
    await openFileEditor(rel, name);
  } else if (action === 'download') {
    const a = document.createElement('a');
    a.href = `/api/servers/${encodeURIComponent(state.sid)}/files/download?path=${encodeURIComponent(rel)}`;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else if (action === 'rename') {
    const next = await promptDialog('Переименовать', { label: 'Новое имя', value: name });
    if (!next || next === name) return;
    try {
      await api(`/api/servers/${encodeURIComponent(state.sid)}/files/rename`, {
        method: 'POST',
        body: { path: rel, name: next },
      });
      toast('Переименовано');
      await loadFiles(state.filesPath);
    } catch (err) {
      toast(err.message, 'err');
    }
  } else if (action === 'delete') {
    if (!(await confirmDialog(`Удалить «${name}»? Отменить это будет нельзя.`, { okLabel: 'Удалить' }))) return;
    try {
      await api(`/api/servers/${encodeURIComponent(state.sid)}/files/delete`, {
        method: 'POST',
        body: { path: rel },
      });
      toast('Удалено');
      await loadFiles(state.filesPath);
    } catch (err) {
      toast(err.message, 'err');
    }
  }
});

$('#crumbs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-crumb]');
  if (!btn) return;
  loadFiles(btn.dataset.crumb).catch((err) => toast(err.message, 'err'));
});

$('#filesUp').addEventListener('click', () => {
  const rel = state.filesPath;
  if (!rel) return;
  const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  loadFiles(parent).catch((err) => toast(err.message, 'err'));
});

$('#filesRefresh').addEventListener('click', () => {
  loadFiles(state.filesPath).catch((err) => toast(err.message, 'err'));
});

$('#filesMkdir').addEventListener('click', async () => {
  const name = await promptDialog('Новая папка', { label: 'Имя папки' });
  if (!name) return;
  try {
    await api(`/api/servers/${encodeURIComponent(state.sid)}/files/mkdir`, {
      method: 'POST',
      body: { path: state.filesPath, name },
    });
    toast('Папка создана');
    await loadFiles(state.filesPath);
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('#filesUploadBtn').addEventListener('click', () => $('#filesInput').click());
$('#filesInput').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  for (const file of files) {
    try {
      const res = await fetch(
        `/api/servers/${encodeURIComponent(state.sid)}/files/upload?path=${encodeURIComponent(state.filesPath)}&name=${encodeURIComponent(file.name)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      toast(`Загружено: ${file.name}`);
    } catch (err) {
      toast(`${file.name}: ${err.message}`, 'err');
    }
  }
  loadFiles(state.filesPath).catch(() => {});
});

async function openFileEditor(rel, name) {
  let data;
  try {
    data = await api(`/api/servers/${encodeURIComponent(state.sid)}/files/read?path=${encodeURIComponent(rel)}`);
  } catch (err) {
    toast(err.message, 'err');
    return;
  }
  const wrap = document.createElement('div');
  const ta = document.createElement('textarea');
  ta.value = data.content;
  wrap.appendChild(ta);

  const m = openModal({
    title: name || rel,
    body: wrap,
    wide: true,
    actions: [
      { label: 'Отмена', kind: 'ghost', onClick: () => m.close() },
      {
        label: 'Сохранить',
        kind: 'primary',
        onClick: async () => {
          try {
            await api(`/api/servers/${encodeURIComponent(state.sid)}/files/write`, {
              method: 'POST',
              body: { path: rel, content: ta.value },
            });
            toast('Файл сохранён');
            m.close();
            await loadFiles(state.filesPath);
          } catch (err) {
            toast(err.message, 'err');
          }
        },
      },
    ],
  });
}

// ------------------------------------------------------------------ моды

async function loadMods() {
  if (!state.sid) return;
  const data = await api(`/api/servers/${encodeURIComponent(state.sid)}/mods`);
  state.mods = data.mods || [];
  $('#modCount').textContent = `вкл. ${data.enabled || 0} · выкл. ${data.disabled || 0}`;
  renderMods();
}

function renderMods() {
  const filter = state.modFilter.toLowerCase();
  const mods = state.mods.filter((m) => !filter || m.name.toLowerCase().includes(filter));
  const body = $('#modsBody');
  if (!mods.length) {
    body.innerHTML = `<tr><td colspan="4" class="empty">${state.mods.length ? 'Ничего не найдено' : 'Моды не найдены (папка mods пуста)'}</td></tr>`;
    return;
  }
  body.innerHTML = mods.map((mod) => `
    <tr>
      <td>
        <span class="file-name" style="cursor:default">
          <span class="file-icon">${mod.enabled ? '🧩' : '🚫'}</span>
          <span>${escapeHtml(mod.name)}</span>
        </span>
      </td>
      <td class="col-size">${escapeHtml(fmtSize(mod.size))}</td>
      <td class="col-date">${escapeHtml(fmtDate(mod.mtime))}</td>
      <td class="col-actions">
        <button class="btn tiny ${mod.enabled ? 'ghost' : 'primary'}" type="button" data-mod="toggle" data-name="${escapeHtml(mod.name)}">${mod.enabled ? 'Выключить' : 'Включить'}</button>
        <button class="btn tiny danger" type="button" data-mod="delete" data-name="${escapeHtml(mod.name)}">Удалить</button>
      </td>
    </tr>`).join('');
}

$('#modSearch').addEventListener('input', (e) => {
  state.modFilter = e.target.value.trim();
  renderMods();
});

$('#modsBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-mod]');
  if (!btn) return;
  const name = btn.dataset.name;
  const action = btn.dataset.mod;
  try {
    if (action === 'toggle') {
      const res = await api(`/api/servers/${encodeURIComponent(state.sid)}/mods/toggle`, {
        method: 'POST',
        body: { name },
      });
      toast(res.warning || (res.enabled ? 'Мод включён' : 'Мод выключен'));
      await loadMods();
    } else if (action === 'delete') {
      if (!(await confirmDialog(`Удалить мод «${name}»?`, { okLabel: 'Удалить' }))) return;
      await api(`/api/servers/${encodeURIComponent(state.sid)}/mods/delete`, {
        method: 'POST',
        body: { name },
      });
      toast('Мод удалён');
      await loadMods();
    }
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('#modsUploadBtn').addEventListener('click', () => $('#modsInput').click());
$('#modsInput').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  for (const file of files) {
    if (!/\.jar$/i.test(file.name)) {
      toast(`${file.name}: нужен файл .jar`, 'err');
      continue;
    }
    try {
      const res = await fetch(
        `/api/servers/${encodeURIComponent(state.sid)}/mods/upload?name=${encodeURIComponent(file.name)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      toast(`Загружено: ${file.name}`);
    } catch (err) {
      toast(`${file.name}: ${err.message}`, 'err');
    }
  }
  await loadMods();
});

// ------------------------------------------------------------------ бэкапы

function backupBanner(text, kind = '') {
  const box = $('#backupBanner');
  if (!text) {
    box.classList.add('hidden');
    box.textContent = '';
    return;
  }
  box.className = `banner ${kind}`;
  box.textContent = text;
}

function setBackupBusy(busy) {
  $$('[data-backup]').forEach((b) => {
    b.disabled = busy;
  });
}

async function loadBackups() {
  if (!state.sid) return;
  const data = await api(`/api/servers/${encodeURIComponent(state.sid)}/backups`);
  state.backups = data.backups || [];
  renderBackups();
  if (data.busy) backupBanner('Сейчас выполняется операция с бэкапами…');
}

function renderBackups() {
  const body = $('#backupsBody');
  if (!state.backups.length) {
    body.innerHTML = '<tr><td colspan="5" class="empty">Бэкапов пока нет</td></tr>';
    return;
  }
  const scopeNames = { world: 'Мир', config: 'Конфиги', full: 'Полный' };
  body.innerHTML = state.backups.map((b) => `
    <tr>
      <td>
        <span class="file-name" style="cursor:default">
          <span class="file-icon">${b.auto ? '🕒' : '💾'}</span>
          <span>${escapeHtml(b.name)}</span>
        </span>
      </td>
      <td>${escapeHtml((b.auto ? 'авто · ' : '') + (scopeNames[b.scope] || b.scope))}</td>
      <td class="col-size">${escapeHtml(fmtSize(b.size))}</td>
      <td class="col-date">${escapeHtml(fmtDate(b.mtime))}</td>
      <td class="col-actions">
        <a class="btn tiny ghost" href="/api/servers/${encodeURIComponent(state.sid)}/backups/${encodeURIComponent(b.name)}/download">Скачать</a>
        <button class="btn tiny ghost" type="button" data-backup-action="restore:${escapeHtml(b.name)}">Восстановить</button>
        <button class="btn tiny danger" type="button" data-backup-action="delete:${escapeHtml(b.name)}">Удалить</button>
      </td>
    </tr>`).join('');
}

async function createBackup(scope) {
  if (!state.sid) return;
  const names = { world: 'мира', config: 'конфигов', full: 'полный (всё, кроме бэкапов и логов)' };
  if (!(await confirmDialog(`Создать бэкап ${names[scope]}? Сервер на время архивации может кратко замереть.`, { okLabel: 'Создать', danger: false }))) return;
  setBackupBusy(true);
  backupBanner('Создаю бэкап… Это может занять несколько минут. Не закрывайте страницу.');
  try {
    const res = await api(`/api/servers/${encodeURIComponent(state.sid)}/backups`, {
      method: 'POST',
      body: { scope },
    });
    toast(`Бэкап создан: ${res.backup.name}`);
    backupBanner('');
  } catch (err) {
    toast(err.message, 'err');
    backupBanner(err.message, 'err');
  } finally {
    setBackupBusy(false);
    loadBackups().catch(() => {});
  }
}

$$('[data-backup]').forEach((btn) => {
  btn.addEventListener('click', () => createBackup(btn.dataset.backup));
});

$('#backupsBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-backup-action]');
  if (!btn) return;
  const [action, name] = btn.dataset.backupAction.split(':');
  if (action === 'delete') {
    if (!(await confirmDialog(`Удалить бэкап «${name}»?`, { okLabel: 'Удалить' }))) return;
    try {
      await api(`/api/servers/${encodeURIComponent(state.sid)}/backups/${encodeURIComponent(name)}`, { method: 'DELETE' });
      toast('Бэкап удалён');
      await loadBackups();
    } catch (err) {
      toast(err.message, 'err');
    }
  } else if (action === 'restore') {
    const ok = await confirmDialog(
      `Восстановить «${name}»? Сервер будет остановлен, текущие папки мира сохранятся с приставкой .before-restore. После восстановления сервер нужно запустить вручную.`,
      { title: 'Восстановление бэкапа', okLabel: 'Восстановить' },
    );
    if (!ok) return;
    setBackupBusy(true);
    backupBanner('Останавливаю сервер и распаковываю бэкап… Это может занять несколько минут.');
    try {
      const res = await api(
        `/api/servers/${encodeURIComponent(state.sid)}/backups/${encodeURIComponent(name)}/restore`,
        { method: 'POST' },
      );
      backupBanner(res.warning || 'Готово', 'warn');
      toast('Бэкап восстановлен. Сервер не запущен.');
      await loadBackups();
      refreshSideStatus();
    } catch (err) {
      toast(err.message, 'err');
      backupBanner(err.message, 'err');
    } finally {
      setBackupBusy(false);
    }
  }
});

async function loadSchedule() {
  if (!state.sid) return;
  const data = await api(`/api/servers/${encodeURIComponent(state.sid)}/backup-schedule`);
  const cfg = data.autobackup || {};
  const form = $('#scheduleForm');
  form.elements.enabled.checked = Boolean(cfg.enabled);
  form.elements.everyHours.value = cfg.everyHours || 6;
  form.elements.keep.value = cfg.keep || 5;
  form.elements.scope.value = cfg.scope || 'world';
}

$('#scheduleForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api(`/api/servers/${encodeURIComponent(state.sid)}/backup-schedule`, {
      method: 'POST',
      body: {
        enabled: f.elements.enabled.checked,
        everyHours: Number(f.elements.everyHours.value) || 6,
        keep: Number(f.elements.keep.value) || 5,
        scope: f.elements.scope.value,
      },
    });
    toast('Расписание сохранено');
  } catch (err) {
    toast(err.message, 'err');
  }
});

// ------------------------------------------------------------------ настройки

async function loadSettings() {
  if (!state.sid) return;
  const data = await api(`/api/servers/${encodeURIComponent(state.sid)}/settings`);
  state.settings = data;
  renderSettingsFields(data);
  const jvm = $('#jvmForm');
  jvm.elements.min.value = data.jvm.min || '';
  jvm.elements.max.value = data.jvm.max || '';
  $('#removeServerName').textContent = (currentServer() || {}).name || 'сервер';
}

function renderSettingsFields(data) {
  const box = $('#settingsFields');
  box.innerHTML = data.spec.map((spec) => {
    const value = data.settings[spec.key];
    if (spec.type === 'bool') {
      return `<label class="check-field"><input type="checkbox" data-key="${escapeHtml(spec.key)}"${value ? ' checked' : ''}> ${escapeHtml(spec.label)}</label>`;
    }
    if (spec.type === 'enum') {
      const options = spec.values.map((v) => `<option value="${escapeHtml(v)}"${v === value ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('');
      return `<label class="field"><span>${escapeHtml(spec.label)}</span><select data-key="${escapeHtml(spec.key)}">${options}</select></label>`;
    }
    if (spec.type === 'int') {
      return `<label class="field"><span>${escapeHtml(spec.label)}</span><input type="number" data-key="${escapeHtml(spec.key)}" min="${spec.min}" max="${spec.max}" value="${escapeHtml(value)}"></label>`;
    }
    return `<label class="field"><span>${escapeHtml(spec.label)}</span><input type="text" data-key="${escapeHtml(spec.key)}" maxlength="${spec.max || 256}" value="${escapeHtml(value)}"></label>`;
  }).join('');
}

$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const settings = {};
  $$('#settingsFields [data-key]').forEach((el) => {
    settings[el.dataset.key] = el.type === 'checkbox' ? el.checked : el.value;
  });
  try {
    await api(`/api/servers/${encodeURIComponent(state.sid)}/settings`, {
      method: 'POST',
      body: { settings },
    });
    toast('Настройки сохранены. Перезапустите сервер, чтобы применить.');
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('#jvmForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api(`/api/servers/${encodeURIComponent(state.sid)}/settings`, {
      method: 'POST',
      body: { jvm: { min: f.elements.min.value.trim(), max: f.elements.max.value.trim() } },
    });
    toast('Память Java сохранена. Перезапустите сервер, чтобы применить.');
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('#passwordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const current = f.elements.current.value;
  const next = f.elements.next.value;
  const repeat = f.elements.repeat.value;
  if (next !== repeat) {
    toast('Пароли не совпадают', 'err');
    return;
  }
  try {
    await api('/api/password', { method: 'POST', body: { current, next } });
    toast('Пароль панели изменён');
    f.reset();
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('#removeServerBtn').addEventListener('click', async () => {
  const srv = currentServer();
  if (!srv) return;
  const ok = await confirmDialog(
    `Убрать «${srv.name}» из панели? Файлы, миры и служба на диске останутся нетронутыми, но управление этим сервером из панели станет недоступно.`,
    { title: 'Убрать сервер', okLabel: 'Убрать' },
  );
  if (!ok) return;
  try {
    await api(`/api/servers/${encodeURIComponent(srv.id)}`, { method: 'DELETE' });
    toast('Сервер убран из панели');
    state.sid = null;
    localStorage.removeItem(SID_KEY);
    if (state.es) state.es.close();
    state.es = null;
    await loadServers();
    await navigate('desk');
  } catch (err) {
    toast(err.message, 'err');
  }
});

// ------------------------------------------------------------------ запуск

boot();
