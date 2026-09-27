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

// ── API fetch ─────────────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const token = getToken();
  const res = await fetch(API_BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  if (res.status === 401) { clearAuth(); window.location.href = '/index.html'; }
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

document.addEventListener('DOMContentLoaded', () => { initNavbar(); initThemeToggle(); initPasswordToggles(); });
