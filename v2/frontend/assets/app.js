// SisLicit v2 — shared utilities
// Loaded in every page; page-specific logic lives inline in each HTML file.

// ── Config ────────────────────────────────────────────────────────────────────
// Set window.API_BASE before loading this file, e.g.:
// <script>window.API_BASE = 'https://sislicit-api.projetos-ept.workers.dev';</script>
const API_BASE = window.API_BASE ?? '';

// ── Theme (dark/light) ──────────────────────────────────────────────────────────
// Aplicado assim que o script carrega, antes do DOMContentLoaded, pra evitar flash.
(function () {
  let saved = 'dark';
  try { saved = localStorage.getItem('sl_theme') || 'dark'; } catch {}
  document.documentElement.setAttribute('data-theme', saved);
})();

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const next = cur === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('sl_theme', next); } catch {}
  document.querySelectorAll('.theme-toggle').forEach(btn => btn.textContent = next === 'light' ? '🌙' : '☀️');
}

function initThemeToggle() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'theme-toggle';
  btn.title = 'Alternar tema claro/escuro';
  btn.textContent = isLight ? '🌙' : '☀️';
  btn.onclick = toggleTheme;

  const navUser = document.querySelector('.navbar-user');
  if (navUser) navUser.prepend(btn);
  else {
    btn.style.position = 'fixed';
    btn.style.top = '16px';
    btn.style.right = '16px';
    document.body.appendChild(btn);
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function getToken()  { return localStorage.getItem('sl_token'); }
function getUser()   { try { return JSON.parse(localStorage.getItem('sl_user') ?? 'null'); } catch { return null; } }
function setAuth(token, user) { localStorage.setItem('sl_token', token); localStorage.setItem('sl_user', JSON.stringify(user)); }
function clearAuth() { localStorage.removeItem('sl_token'); localStorage.removeItem('sl_user'); }

function requireAuth() {
  if (!getToken()) { window.location.href = '/index.html'; }
}

function logout() {
  clearAuth();
  window.location.href = '/index.html';
}

// ── Offline storage (cache de leitura + fila de ações pendentes) ────────────────
// Guarda a última resposta boa-sucedida de cada GET, e enfileira escritas
// (POST/PATCH/DELETE) feitas sem conexão para reenviar depois via sincronização.
const OFFLINE_CACHE_PREFIX = 'sl_cache:';
const OFFLINE_QUEUE_KEY = 'sl_offline_queue';

function offlineSaveCache(path, data) {
  try { localStorage.setItem(OFFLINE_CACHE_PREFIX + path, JSON.stringify({ data, ts: Date.now() })); } catch {}
}
function offlineLoadCache(path) {
  try {
    const raw = localStorage.getItem(OFFLINE_CACHE_PREFIX + path);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
function offlineGetQueue() {
  try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) ?? '[]'); } catch { return []; }
}
function offlineSetQueue(q) {
  try { localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q)); } catch {}
}
function offlineEnqueue(path, opts) {
  const q = offlineGetQueue();
  q.push({ id: Date.now() + '-' + Math.random().toString(36).slice(2), path, method: (opts.method ?? 'POST').toUpperCase(), body: opts.body ?? null, ts: Date.now() });
  offlineSetQueue(q);
  updateSyncBadge();
}
function offlineQueueCount() { return offlineGetQueue().length; }

// Reenvia, em ordem, as ações que ficaram pendentes enquanto o app estava sem
// conexão. Cada ação só sai da fila se a resposta do servidor for de sucesso.
async function forcarSincronizacao() {
  const fila = offlineGetQueue();
  let ok = 0, falha = 0;
  const restantes = [];
  for (const acao of fila) {
    try {
      const token = getToken();
      const res = await fetch(API_BASE + acao.path, {
        method: acao.method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: acao.body,
      });
      if (res.ok) ok++; else { falha++; restantes.push(acao); }
    } catch { falha++; restantes.push(acao); }
  }
  offlineSetQueue(restantes);
  updateSyncBadge();
  return { ok, falha, restantes: restantes.length };
}

function updateSyncBadge() {
  const n = offlineQueueCount();
  document.querySelectorAll('.sync-badge').forEach(el => {
    el.textContent = n > 0 ? `⏳ ${n} pendente${n > 1 ? 's' : ''}` : '';
    el.classList.toggle('hidden', n === 0);
  });
}

function updateConnectionStatus() {
  const online = navigator.onLine;
  document.querySelectorAll('.conn-status').forEach(el => {
    el.textContent = online ? '🟢 Online' : '🔴 Offline';
    el.title = online ? 'Conectado ao servidor' : 'Sem conexão — usando dados salvos localmente';
  });
}
window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);

// ── API fetch ─────────────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const token = getToken();
  const method = (opts.method ?? 'GET').toUpperCase();
  let res;
  try {
    res = await fetch(API_BASE + path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers ?? {}),
      },
    });
  } catch (err) {
    // fetch() rejeita em falha de rede/CORS — sem isso, o erro fica silencioso
    // (promise rejeitada sem handler) e a UI parece simplesmente não fazer nada.
    console.error('apiFetch falhou:', path, err);

    if (method === 'GET') {
      const cached = offlineLoadCache(path);
      if (cached) {
        toast('Sem conexão — mostrando dados salvos localmente', 'err');
        return {
          ok: true, status: 0, fromCache: true,
          json: async () => cached.data,
          blob: async () => new Blob([]),
          text: async () => JSON.stringify(cached.data),
        };
      }
      toast('Sem conexão e nenhum dado salvo localmente para esta tela.', 'err');
    } else {
      offlineEnqueue(path, opts);
      toast('Sem conexão — ação salva e será enviada ao sincronizar.', 'err');
    }
    return {
      ok: false,
      status: 0,
      json: async () => ({ error: 'Falha de conexão com o servidor' }),
      blob: async () => new Blob([]),
      text: async () => '',
    };
  }
  if (res.status === 401) { clearAuth(); window.location.href = '/index.html'; }
  if (method === 'GET' && res.ok) {
    res.clone().json().then(data => offlineSaveCache(path, data)).catch(() => {});
  }
  return res;
}

// ── BRL format ────────────────────────────────────────────────────────────────
function fmtBRL(v) {
  return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let _toastTimer;
function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `show ${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = ''; }, 2800);
}

// ── Busy state (evita duplo-clique/duplo-submit em ações assíncronas) ──────────
async function withBusy(btn, label, fn) {
  if (!btn || btn.disabled) return;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  try {
    await fn();
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

// ── Rede de segurança: nenhuma falha deve ficar silenciosa ──────────────────────
window.addEventListener('unhandledrejection', (e) => {
  console.error('Erro não tratado:', e.reason);
  toast('Ocorreu um erro inesperado. Tente novamente.', 'err');
});

// ── Modais: Escape fecha o topo mais recente aberto ────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = document.querySelectorAll('.modal-backdrop.open');
  if (open.length) open[open.length - 1].classList.remove('open');
});

// ── Mostrar/ocultar senha ───────────────────────────────────────────────────────
function initPasswordToggles() {
  document.querySelectorAll('input[type="password"]').forEach(input => {
    if (input.dataset.toggleBound) return;
    input.dataset.toggleBound = '1';
    const wrap = document.createElement('div');
    wrap.style.position = 'relative';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    input.style.paddingRight = '38px';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-toggle';
    btn.tabIndex = -1;
    btn.title = 'Mostrar/ocultar senha';
    btn.textContent = '👁';
    btn.onclick = () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? '🙈' : '👁';
    };
    wrap.appendChild(btn);
  });
}

// ── Navbar user info ──────────────────────────────────────────────────────────
function initNavbar() {
  const user = getUser();
  const el = document.getElementById('nav-user');
  if (el && user) el.textContent = `${user.username} · ${user.role}`;
  document.querySelectorAll('[data-admin-only]').forEach(el => {
    if (user?.role !== 'admin') el.style.display = 'none';
  });
}

function initConnStatusBadge() {
  const navUser = document.querySelector('.navbar-user');
  if (!navUser) return;
  const conn = document.createElement('span');
  conn.className = 'conn-status';
  conn.style.fontSize = '0.75rem';
  navUser.prepend(conn);
  const sync = document.createElement('span');
  sync.className = 'sync-badge hidden';
  sync.style.fontSize = '0.75rem';
  sync.style.color = 'var(--warning)';
  navUser.prepend(sync);
  updateConnectionStatus();
  updateSyncBadge();
}

document.addEventListener('DOMContentLoaded', () => { initNavbar(); initThemeToggle(); initPasswordToggles(); initConnStatusBadge(); });
