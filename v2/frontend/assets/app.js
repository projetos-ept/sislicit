// SisLicit v2 — shared utilities
// Loaded in every page; page-specific logic lives inline in each HTML file.

// ── Config ────────────────────────────────────────────────────────────────────
// Set window.API_BASE before loading this file, e.g.:
// <script>window.API_BASE = 'https://sislicit-api.projetos-ept.workers.dev';</script>
const API_BASE = window.API_BASE ?? '';

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

// ── Navbar user info ──────────────────────────────────────────────────────────
function initNavbar() {
  const user = getUser();
  const el = document.getElementById('nav-user');
  if (el && user) el.textContent = `${user.username} · ${user.role}`;
  document.querySelectorAll('[data-admin-only]').forEach(el => {
    if (user?.role !== 'admin') el.style.display = 'none';
  });
}

document.addEventListener('DOMContentLoaded', initNavbar);
