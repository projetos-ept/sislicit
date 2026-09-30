// SisLicit v2 — shared utilities
// Loaded in every page; page-specific logic lives inline in each HTML file.

// ── Config ────────────────────────────────────────────────────────────────────
// Set window.API_BASE before loading this file, e.g.:
// <script>window.API_BASE = 'https://sislicit-api.projetos-ept.workers.dev';</script>
const API_BASE = window.API_BASE ?? '';

// ── Prompt de importação via IA (compartilhado entre Admin e a tela de item) ────
const PROMPT_IMPORTAR_IA = `Você é um assistente que transforma um pedido de compra/licitação em um JSON estruturado para importação no sistema SisLicit.

Regras:
- Responda APENAS com o JSON puro, sem texto antes ou depois, sem markdown (sem \`\`\`).
- O formato de saída é um array de itens, seguindo exatamente este schema:
  [
    { "item": "string (obrigatório)", "descricao": "string (opcional)", "unidade": "string (opcional, ex: UN, CX, KG)", "quantidade": number, "valor_unitario": number, "categoria": "string (opcional)" }
  ]
- Não inclua "valor_total" — ele é calculado automaticamente (quantidade × valor_unitario).
- Extraia quantidade e unidade do texto sempre que possível (ex.: "10 cadeiras" → quantidade: 10, unidade: "UN").
- Se o valor unitário não for informado no pedido, use 0.
- "categoria" é o nome de um grupo/categoria pro item (ex.: "Mobiliário", "Informática", "EPI"). Se o pedido não indicar categorias, pode omitir o campo. Categorias com o mesmo nome (sem diferenciar maiúsculas/minúsculas) são agrupadas automaticamente na importação; se ainda não existirem no sistema, são criadas.
- Um item por linha/produto do pedido; não agrupe itens diferentes.

Exemplo de saída válida:
[
  { "item": "Cadeira de escritório giratória", "descricao": "Com apoio de braço, cor preta", "unidade": "UN", "quantidade": 10, "valor_unitario": 350.00, "categoria": "Mobiliário" },
  { "item": "Mesa de reunião 6 lugares", "unidade": "UN", "quantidade": 2, "valor_unitario": 1200.00, "categoria": "Mobiliário" },
  { "item": "Resma de papel A4", "unidade": "CX", "quantidade": 5, "valor_unitario": 22.90, "categoria": "Material de escritório" }
]

Pedido a transformar (cole abaixo, entre as aspas triplas):
"""
COLE AQUI O TEXTO DO PEDIDO/EDITAL
"""`;

function copiarPromptImportarIA() {
  navigator.clipboard.writeText(PROMPT_IMPORTAR_IA).then(
    () => toast('Prompt copiado — cole numa IA junto com o texto do pedido', 'ok'),
    () => toast('Não foi possível copiar — selecione o texto manualmente', 'err')
  );
}

// ── Paleta padrão de cores para categorias ───────────────────────────────────────
// Tons claros/pastel: o backend (calcularVariantes) escurece/satura pra gerar
// borda e texto legíveis a partir dessa cor base, então cores claras aqui
// resultam em selos e linhas "claras com texto escuro", nao blocos saturados.
const CATEGORIA_PALETTE = [
  { nome: 'Azul',     hex: '#BFDBFE' },
  { nome: 'Amarelo',  hex: '#FEF08A' },
  { nome: 'Laranja',  hex: '#FED7AA' },
  { nome: 'Cinza',    hex: '#E5E7EB' },
  { nome: 'Verde',    hex: '#BBF7D0' },
  { nome: 'Vermelho', hex: '#FECACA' },
  { nome: 'Roxo',     hex: '#DDD6FE' },
  { nome: 'Ciano',    hex: '#A5F3FC' },
];

// Renderiza os círculos de cor dentro de `container` (um elemento já no DOM) e
// chama `onPick(hex)` quando um deles é clicado.
function renderCategoriaPalette(container, onPick) {
  container.innerHTML = CATEGORIA_PALETTE.map(c =>
    `<button type="button" class="palette-swatch" title="${c.nome}" data-hex="${c.hex}" style="background:${c.hex}"></button>`
  ).join('');
  container.querySelectorAll('.palette-swatch').forEach(btn => {
    btn.addEventListener('click', () => onPick(btn.dataset.hex));
  });
}

// Escolhe a próxima cor da paleta em rotação, com base em quantas categorias
// já existem — assim, categorias novas nao nascem todas com a mesma cor.
function proximaCorPalette(totalCategoriasExistentes) {
  return CATEGORIA_PALETTE[totalCategoriasExistentes % CATEGORIA_PALETTE.length].hex;
}

// Porta de calcularVariantes() do worker (src/utils.ts) — só pra prévia no
// cliente antes de salvar; o valor real que fica salvo é sempre recalculado
// pelo servidor.
function calcularVariantesPreview(corHex) {
  const h = corHex.replace('#', '');
  const r = parseInt(h.slice(0,2),16)/255, g = parseInt(h.slice(2,4),16)/255, b = parseInt(h.slice(4,6),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue = hue / 6;
    if (hue < 0) hue += 1;
  }
  const s = max === 0 ? 0 : d / max, v = max;
  const hsvToHex = (hh, ss, vv) => {
    const f = (n) => { const k = (n + hh * 6) % 6; return vv - vv * ss * Math.max(0, Math.min(k, 4 - k, 1)); };
    return '#' + [f(5), f(3), f(1)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
  };
  return {
    cor_borda_hex: hsvToHex(hue, Math.min(1, s + 0.20), Math.max(0, v - 0.15)),
    cor_texto_hex: hsvToHex(hue, Math.min(1, s + 0.40), Math.max(0, v - 0.45)),
  };
}

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
