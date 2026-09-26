// ── BRL formatting ────────────────────────────────────────────────────────────

export function fmtBRL(v: number | null | undefined): string {
  if (v == null) return 'R$ 0,00';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ── HSV color variants (port of Python calcular_variantes) ───────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0,2),16)/255, parseInt(h.slice(2,4),16)/255, parseInt(h.slice(4,6),16)/255];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r)      h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;
    h = h / 6;
    if (h < 0) h += 1;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return '#' + [f(5), f(3), f(1)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

export function calcularVariantes(corHex: string): { cor_borda_hex: string; cor_texto_hex: string } {
  const [r, g, b] = hexToRgb(corHex);
  const [h, s, v] = rgbToHsv(r, g, b);
  const cor_borda_hex = hsvToHex(h, Math.min(1, s + 0.20), Math.max(0, v - 0.15));
  const cor_texto_hex = hsvToHex(h, Math.min(1, s + 0.40), Math.max(0, v - 0.45));
  return { cor_borda_hex, cor_texto_hex };
}

// ── Renumber items after insert/delete ───────────────────────────────────────

export async function renumerar(db: D1Database, planilhaId: number) {
  const rows = await db.prepare(
    'SELECT id FROM itens WHERE planilha_id = ? ORDER BY ordem ASC'
  ).bind(planilhaId).all<{ id: number }>();
  const stmts = rows.results.map((row, i) =>
    db.prepare('UPDATE itens SET n = ?, ordem = ? WHERE id = ?').bind(i + 1, i + 1, row.id)
  );
  if (stmts.length) await db.batch(stmts);
}

// ── Planilha total ────────────────────────────────────────────────────────────

export async function planilhaTotal(db: D1Database, planilhaId: number): Promise<number> {
  const r = await db.prepare(
    'SELECT COALESCE(SUM(valor_total),0) AS total FROM itens WHERE planilha_id = ?'
  ).bind(planilhaId).first<{ total: number }>();
  return r?.total ?? 0;
}

// ── Touch planilha atualizado_em ──────────────────────────────────────────────

export async function touchPlanilha(db: D1Database, planilhaId: number) {
  await db.prepare("UPDATE planilhas SET atualizado_em = datetime('now') WHERE id = ?")
    .bind(planilhaId).run();
}
