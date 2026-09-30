import { Hono } from 'hono';
import type { Env } from '../index';
import type { JWTPayload } from '../auth';
import { calcularVariantes, fmtBRL, proximaCorPalette, renumerar, touchPlanilha } from '../utils';
import { gerarXlsxPlanilha } from '../xlsx-writer';

type PlanilhaRow = { id: number; titulo: string; descricao: string | null; numero_proc: string | null; criado_por: number; criado_em: string; atualizado_em: string };
type ItemRow     = { id: number; planilha_id: number; categoria_id: number | null; n: number; ordem: number; item: string; descricao: string | null; unidade: string | null; quantidade: number; valor_unitario: number; valor_total: number; cat_nome?: string; cat_cor?: string; cat_cor_borda?: string; cat_cor_texto?: string };

const app = new Hono<{ Bindings: Env }>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function canAccess(user: JWTPayload, planilha: PlanilhaRow) {
  return user.role === 'admin' || planilha.criado_por === user.id;
}

async function getPlanilha(db: D1Database, id: number): Promise<PlanilhaRow | null> {
  return db.prepare('SELECT * FROM planilhas WHERE id = ?').bind(id).first<PlanilhaRow>();
}

async function getTotais(db: D1Database, planilhaId: number): Promise<{ total: number; total_itens: number }> {
  const r = await db.prepare(
    'SELECT COALESCE(SUM(valor_total),0) AS t, COUNT(*) AS n FROM itens WHERE planilha_id = ?'
  ).bind(planilhaId).first<{ t: number; n: number }>();
  return { total: r?.t ?? 0, total_itens: r?.n ?? 0 };
}

// ── PLANILHAS ─────────────────────────────────────────────────────────────────

app.get('/', async (c) => {
  const user = c.get('user') as JWTPayload;
  const q = user.role === 'admin'
    ? 'SELECT * FROM planilhas ORDER BY atualizado_em DESC'
    : 'SELECT * FROM planilhas WHERE criado_por = ? ORDER BY atualizado_em DESC';
  const rows = user.role === 'admin'
    ? await c.env.DB.prepare(q).all<PlanilhaRow>()
    : await c.env.DB.prepare(q).bind(user.id).all<PlanilhaRow>();
  return c.json({ planilhas: rows.results });
});

app.post('/', async (c) => {
  const user = c.get('user') as JWTPayload;
  const { titulo, descricao, numero_proc } = await c.req.json<{ titulo: string; descricao?: string; numero_proc?: string }>();
  if (!titulo?.trim()) return c.json({ error: 'Título obrigatório' }, 400);
  const r = await c.env.DB.prepare(
    'INSERT INTO planilhas (titulo, descricao, numero_proc, criado_por) VALUES (?, ?, ?, ?) RETURNING *'
  ).bind(titulo.trim(), descricao ?? null, numero_proc ?? null, user.id).first<PlanilhaRow>();
  return c.json({ planilha: r }, 201);
});

app.get('/:id', async (c) => {
  const user = c.get('user') as JWTPayload;
  const planilha = await getPlanilha(c.env.DB, Number(c.req.param('id')));
  if (!planilha) return c.json({ error: 'Não encontrado' }, 404);
  if (!canAccess(user, planilha)) return c.json({ error: 'Sem acesso' }, 403);

  const itens = await c.env.DB.prepare(`
    SELECT i.*, c.nome AS cat_nome, c.cor_hex AS cat_cor, c.cor_borda_hex AS cat_cor_borda, c.cor_texto_hex AS cat_cor_texto
    FROM itens i LEFT JOIN categorias c ON i.categoria_id = c.id
    WHERE i.planilha_id = ? ORDER BY i.ordem ASC
  `).bind(planilha.id).all<ItemRow>();

  const total = itens.results.reduce((s, i) => s + i.valor_total, 0);
  const cats = await c.env.DB.prepare('SELECT * FROM categorias ORDER BY nome').all();

  return c.json({ planilha, itens: itens.results, total, total_fmt: fmtBRL(total), categorias: cats.results });
});

app.patch('/:id', async (c) => {
  const user = c.get('user') as JWTPayload;
  const planilha = await getPlanilha(c.env.DB, Number(c.req.param('id')));
  if (!planilha) return c.json({ error: 'Não encontrado' }, 404);
  if (!canAccess(user, planilha)) return c.json({ error: 'Sem acesso' }, 403);

  const { titulo, descricao, numero_proc } = await c.req.json<{ titulo?: string; descricao?: string; numero_proc?: string }>();
  await c.env.DB.prepare(
    "UPDATE planilhas SET titulo = COALESCE(?, titulo), descricao = COALESCE(?, descricao), numero_proc = COALESCE(?, numero_proc), atualizado_em = datetime('now') WHERE id = ?"
  ).bind(titulo ?? null, descricao ?? null, numero_proc ?? null, planilha.id).run();
  return c.json({ ok: true });
});

app.delete('/:id', async (c) => {
  const user = c.get('user') as JWTPayload;
  if (user.role !== 'admin') return c.json({ error: 'Sem permissão' }, 403);
  const planilha = await getPlanilha(c.env.DB, Number(c.req.param('id')));
  if (!planilha) return c.json({ error: 'Não encontrado' }, 404);
  await c.env.DB.prepare('DELETE FROM planilhas WHERE id = ?').bind(planilha.id).run();
  return c.json({ ok: true });
});

app.post('/:id/duplicar', async (c) => {
  const user = c.get('user') as JWTPayload;
  const planilha = await getPlanilha(c.env.DB, Number(c.req.param('id')));
  if (!planilha) return c.json({ error: 'Não encontrado' }, 404);
  if (!canAccess(user, planilha)) return c.json({ error: 'Sem acesso' }, 403);

  const itens = await c.env.DB.prepare('SELECT * FROM itens WHERE planilha_id = ? ORDER BY ordem ASC')
    .bind(planilha.id).all<ItemRow>();

  const nova = await c.env.DB.prepare(
    'INSERT INTO planilhas (titulo, descricao, numero_proc, criado_por) VALUES (?, ?, ?, ?) RETURNING *'
  ).bind(`${planilha.titulo} (cópia)`, planilha.descricao, planilha.numero_proc, user.id).first<PlanilhaRow>();

  if (itens.results.length) {
    const stmts = itens.results.map(i => c.env.DB.prepare(
      'INSERT INTO itens (planilha_id, categoria_id, n, ordem, item, descricao, unidade, quantidade, valor_unitario, valor_total) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).bind(nova!.id, i.categoria_id, i.n, i.ordem, i.item, i.descricao, i.unidade, i.quantidade, i.valor_unitario, i.valor_total));
    await c.env.DB.batch(stmts);
  }

  return c.json({ ok: true, planilha: nova }, 201);
});

// ── ITENS ─────────────────────────────────────────────────────────────────────

app.post('/:id/itens', async (c) => {
  const user = c.get('user') as JWTPayload;
  const planilha = await getPlanilha(c.env.DB, Number(c.req.param('id')));
  if (!planilha) return c.json({ error: 'Não encontrado' }, 404);
  if (!canAccess(user, planilha)) return c.json({ error: 'Sem acesso' }, 403);

  const { item, descricao, unidade, quantidade, valor_unitario, categoria_id } =
    await c.req.json<{ item: string; descricao?: string; unidade?: string; quantidade?: number; valor_unitario?: number; categoria_id?: number }>();
  if (!item?.trim()) return c.json({ error: 'Nome do item obrigatório' }, 400);

  const qtd = Number(quantidade ?? 0);
  const vu  = Number(valor_unitario ?? 0);
  const vt  = qtd * vu;

  const maxOrd = await c.env.DB.prepare('SELECT COALESCE(MAX(ordem),0) AS m FROM itens WHERE planilha_id = ?')
    .bind(planilha.id).first<{ m: number }>();
  const ordem = (maxOrd?.m ?? 0) + 1;
  const n     = ordem;

  const r = await c.env.DB.prepare(
    'INSERT INTO itens (planilha_id, categoria_id, n, ordem, item, descricao, unidade, quantidade, valor_unitario, valor_total) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING *'
  ).bind(planilha.id, categoria_id ?? null, n, ordem, item.trim(), descricao ?? null, unidade ?? null, qtd, vu, vt)
   .first<ItemRow>();

  await touchPlanilha(c.env.DB, planilha.id);
  const { total, total_itens } = await getTotais(c.env.DB, planilha.id);
  return c.json({ ok: true, item: r, total_fmt: fmtBRL(total), total_itens }, 201);
});

// Row-level update (replaces per-campo AJAX)
app.patch('/:id/itens/:iid', async (c) => {
  const user = c.get('user') as JWTPayload;
  const planilha = await getPlanilha(c.env.DB, Number(c.req.param('id')));
  if (!planilha) return c.json({ error: 'Não encontrado' }, 404);
  if (!canAccess(user, planilha)) return c.json({ error: 'Sem acesso' }, 403);

  const iid = Number(c.req.param('iid'));
  const itemRow = await c.env.DB.prepare('SELECT * FROM itens WHERE id = ? AND planilha_id = ?')
    .bind(iid, planilha.id).first<ItemRow>();
  if (!itemRow) return c.json({ error: 'Item não encontrado' }, 404);

  type Patch = { item?: string; descricao?: string; unidade?: string; quantidade?: number; valor_unitario?: number; categoria_id?: number | null };
  const body = await c.req.json<Patch>();

  const qtd = body.quantidade  !== undefined ? Number(body.quantidade)     : itemRow.quantidade;
  const vu  = body.valor_unitario !== undefined ? Number(body.valor_unitario) : itemRow.valor_unitario;
  const vt  = qtd * vu;
  const catId = 'categoria_id' in body ? (body.categoria_id ?? null) : itemRow.categoria_id;

  await c.env.DB.prepare(`
    UPDATE itens SET
      item = COALESCE(?, item),
      descricao = COALESCE(?, descricao),
      unidade = COALESCE(?, unidade),
      quantidade = ?, valor_unitario = ?, valor_total = ?,
      categoria_id = ?
    WHERE id = ?
  `).bind(
    body.item?.trim() ?? null, body.descricao ?? null, body.unidade ?? null,
    qtd, vu, vt, catId, iid
  ).run();

  await touchPlanilha(c.env.DB, planilha.id);
  const updated = await c.env.DB.prepare(`
    SELECT i.*, c.nome AS cat_nome, c.cor_hex AS cat_cor, c.cor_borda_hex AS cat_cor_borda, c.cor_texto_hex AS cat_cor_texto
    FROM itens i LEFT JOIN categorias c ON i.categoria_id = c.id WHERE i.id = ?
  `).bind(iid).first<ItemRow>();

  const total = (await c.env.DB.prepare('SELECT COALESCE(SUM(valor_total),0) AS t FROM itens WHERE planilha_id = ?').bind(planilha.id).first<{ t: number }>())?.t ?? 0;
  return c.json({ ok: true, item: updated, valor_total: vt, valor_total_fmt: fmtBRL(vt), planilha_total_fmt: fmtBRL(total) });
});

app.delete('/:id/itens/:iid', async (c) => {
  const user = c.get('user') as JWTPayload;
  const planilha = await getPlanilha(c.env.DB, Number(c.req.param('id')));
  if (!planilha) return c.json({ error: 'Não encontrado' }, 404);
  if (!canAccess(user, planilha)) return c.json({ error: 'Sem acesso' }, 403);

  await c.env.DB.prepare('DELETE FROM itens WHERE id = ? AND planilha_id = ?')
    .bind(Number(c.req.param('iid')), planilha.id).run();
  await renumerar(c.env.DB, planilha.id);
  await touchPlanilha(c.env.DB, planilha.id);
  const { total, total_itens } = await getTotais(c.env.DB, planilha.id);
  return c.json({ ok: true, total_fmt: fmtBRL(total), total_itens });
});

app.post('/:id/itens/:iid/clonar', async (c) => {
  const user = c.get('user') as JWTPayload;
  const planilha = await getPlanilha(c.env.DB, Number(c.req.param('id')));
  if (!planilha) return c.json({ error: 'Não encontrado' }, 404);
  if (!canAccess(user, planilha)) return c.json({ error: 'Sem acesso' }, 403);

  const orig = await c.env.DB.prepare('SELECT * FROM itens WHERE id = ? AND planilha_id = ?')
    .bind(Number(c.req.param('iid')), planilha.id).first<ItemRow>();
  if (!orig) return c.json({ error: 'Item não encontrado' }, 404);

  // Shift items after original
  await c.env.DB.prepare('UPDATE itens SET ordem = ordem + 1, n = n + 1 WHERE planilha_id = ? AND ordem > ?')
    .bind(planilha.id, orig.ordem).run();

  const clone = await c.env.DB.prepare(
    'INSERT INTO itens (planilha_id, categoria_id, n, ordem, item, descricao, unidade, quantidade, valor_unitario, valor_total) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING *'
  ).bind(planilha.id, orig.categoria_id, orig.n + 1, orig.ordem + 1, orig.item, orig.descricao, orig.unidade, orig.quantidade, orig.valor_unitario, orig.valor_total)
   .first<ItemRow>();

  await touchPlanilha(c.env.DB, planilha.id);

  const cat = orig.categoria_id
    ? await c.env.DB.prepare('SELECT * FROM categorias WHERE id = ?').bind(orig.categoria_id).first<{ nome: string; cor_hex: string; cor_borda_hex: string; cor_texto_hex: string }>()
    : null;

  const { total, total_itens } = await getTotais(c.env.DB, planilha.id);
  return c.json({
    ok: true,
    item: { ...clone, cat_nome: cat?.nome, cat_cor: cat?.cor_hex, cat_cor_borda: cat?.cor_borda_hex, cat_cor_texto: cat?.cor_texto_hex },
    total_fmt: fmtBRL(total),
    total_itens,
  });
});

app.post('/:id/agrupar', async (c) => {
  const user = c.get('user') as JWTPayload;
  const planilha = await getPlanilha(c.env.DB, Number(c.req.param('id')));
  if (!planilha) return c.json({ error: 'Não encontrado' }, 404);
  if (!canAccess(user, planilha)) return c.json({ error: 'Sem acesso' }, 403);

  // Reorder by category name, then original ordem
  const rows = await c.env.DB.prepare(`
    SELECT i.id FROM itens i LEFT JOIN categorias c ON i.categoria_id = c.id
    WHERE i.planilha_id = ? ORDER BY COALESCE(c.nome,'zzz') ASC, i.ordem ASC
  `).bind(planilha.id).all<{ id: number }>();

  const stmts = rows.results.map((row, i) =>
    c.env.DB.prepare('UPDATE itens SET n = ?, ordem = ? WHERE id = ?').bind(i + 1, i + 1, row.id)
  );
  if (stmts.length) await c.env.DB.batch(stmts);
  await touchPlanilha(c.env.DB, planilha.id);
  return c.json({ ok: true });
});

// ── BULK ──────────────────────────────────────────────────────────────────────

app.post('/:id/bulk/excluir', async (c) => {
  const user = c.get('user') as JWTPayload;
  const planilha = await getPlanilha(c.env.DB, Number(c.req.param('id')));
  if (!planilha) return c.json({ error: 'Não encontrado' }, 404);
  if (!canAccess(user, planilha)) return c.json({ error: 'Sem acesso' }, 403);

  const { ids } = await c.req.json<{ ids: number[] }>();
  if (!ids?.length) return c.json({ error: 'Nenhum item selecionado' }, 400);

  const placeholders = ids.map(() => '?').join(',');
  await c.env.DB.prepare(`DELETE FROM itens WHERE planilha_id = ? AND id IN (${placeholders})`)
    .bind(planilha.id, ...ids).run();
  await renumerar(c.env.DB, planilha.id);
  await touchPlanilha(c.env.DB, planilha.id);
  return c.json({ ok: true });
});

app.post('/:id/bulk/copiar', async (c) => {
  const user = c.get('user') as JWTPayload;
  const origem = await getPlanilha(c.env.DB, Number(c.req.param('id')));
  if (!origem) return c.json({ error: 'Não encontrado' }, 404);
  if (!canAccess(user, origem)) return c.json({ error: 'Sem acesso' }, 403);

  const { ids, destino_id } = await c.req.json<{ ids: number[]; destino_id: number }>();
  if (!ids?.length) return c.json({ error: 'Nenhum item selecionado' }, 400);
  if (!destino_id) return c.json({ error: 'Planilha de destino obrigatória' }, 400);
  if (destino_id === origem.id) return c.json({ error: 'Escolha uma planilha de destino diferente da atual' }, 400);

  const destino = await getPlanilha(c.env.DB, destino_id);
  if (!destino) return c.json({ error: 'Planilha de destino não encontrada' }, 404);
  if (!canAccess(user, destino)) return c.json({ error: 'Sem acesso à planilha de destino' }, 403);

  const placeholders = ids.map(() => '?').join(',');
  const itens = await c.env.DB.prepare(
    `SELECT * FROM itens WHERE planilha_id = ? AND id IN (${placeholders}) ORDER BY ordem ASC`
  ).bind(origem.id, ...ids).all<ItemRow>();
  if (!itens.results.length) return c.json({ error: 'Nenhum item encontrado' }, 404);

  const maxOrd = (await c.env.DB.prepare('SELECT COALESCE(MAX(ordem),0) AS m FROM itens WHERE planilha_id = ?')
    .bind(destino.id).first<{ m: number }>())?.m ?? 0;

  const stmts = itens.results.map((i, idx) => c.env.DB.prepare(
    'INSERT INTO itens (planilha_id, categoria_id, n, ordem, item, descricao, unidade, quantidade, valor_unitario, valor_total) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(destino.id, i.categoria_id, maxOrd + idx + 1, maxOrd + idx + 1, i.item, i.descricao, i.unidade, i.quantidade, i.valor_unitario, i.valor_total));
  await c.env.DB.batch(stmts);
  await touchPlanilha(c.env.DB, destino.id);

  return c.json({ ok: true, copiados: itens.results.length });
});

// ── EXPORT JSON ───────────────────────────────────────────────────────────────

app.get('/:id/export/json', async (c) => {
  const user = c.get('user') as JWTPayload;
  const planilha = await getPlanilha(c.env.DB, Number(c.req.param('id')));
  if (!planilha) return c.json({ error: 'Não encontrado' }, 404);
  if (!canAccess(user, planilha)) return c.json({ error: 'Sem acesso' }, 403);

  const itens = await c.env.DB.prepare('SELECT * FROM itens WHERE planilha_id = ? ORDER BY ordem ASC')
    .bind(planilha.id).all<ItemRow>();
  const total = itens.results.reduce((s, i) => s + i.valor_total, 0);

  const payload = JSON.stringify({
    planilha: { titulo: planilha.titulo, descricao: planilha.descricao, numero_proc: planilha.numero_proc },
    total, total_fmt: fmtBRL(total),
    itens: itens.results
  }, null, 2);

  const safe = planilha.titulo.replace(/[^a-z0-9]/gi, '_').slice(0, 40);
  return new Response(payload, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safe}.json"`,
    }
  });
});

// ── EXPORT EXCEL (gerador próprio — ver xlsx-writer.ts) ────────────────────────

app.get('/:id/export/excel', async (c) => {
  const user = c.get('user') as JWTPayload;
  const planilha = await getPlanilha(c.env.DB, Number(c.req.param('id')));
  if (!planilha) return c.json({ error: 'Não encontrado' }, 404);
  if (!canAccess(user, planilha)) return c.json({ error: 'Sem acesso' }, 403);

  const itens = await c.env.DB.prepare(`
    SELECT i.*, c.nome AS cat_nome, c.cor_hex AS cat_cor, c.cor_borda_hex AS cat_cor_borda, c.cor_texto_hex AS cat_cor_texto
    FROM itens i LEFT JOIN categorias c ON i.categoria_id = c.id
    WHERE i.planilha_id = ? ORDER BY i.ordem ASC
  `).bind(planilha.id).all<ItemRow & { cat_nome: string | null; cat_cor: string | null; cat_cor_borda: string | null; cat_cor_texto: string | null }>();

  const total = itens.results.reduce((s, i) => s + i.valor_total, 0);
  const titulo = [planilha.titulo, planilha.numero_proc ? `— ${planilha.numero_proc}` : ''].filter(Boolean).join(' ');
  const buf = gerarXlsxPlanilha(titulo, itens.results, total);

  const safe = planilha.titulo.replace(/[^a-z0-9]/gi, '_').slice(0, 40);
  return new Response(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${safe}.xlsx"`,
    }
  });
});

// ── EXPORT BULK ───────────────────────────────────────────────────────────────

app.post('/:id/bulk/xlsx', async (c) => {
  const user = c.get('user') as JWTPayload;
  const planilha = await getPlanilha(c.env.DB, Number(c.req.param('id')));
  if (!planilha) return c.json({ error: 'Não encontrado' }, 404);
  if (!canAccess(user, planilha)) return c.json({ error: 'Sem acesso' }, 403);

  const { ids } = await c.req.json<{ ids: number[] }>();
  if (!ids?.length) return c.json({ error: 'Nenhum item' }, 400);

  const ph = ids.map(() => '?').join(',');
  const itens = await c.env.DB.prepare(
    `SELECT i.*, c.nome AS cat_nome, c.cor_hex AS cat_cor, c.cor_borda_hex AS cat_cor_borda, c.cor_texto_hex AS cat_cor_texto
     FROM itens i LEFT JOIN categorias c ON i.categoria_id = c.id WHERE i.id IN (${ph}) ORDER BY i.ordem ASC`
  ).bind(...ids).all<ItemRow & { cat_nome: string | null; cat_cor: string | null; cat_cor_borda: string | null; cat_cor_texto: string | null }>();

  const total = itens.results.reduce((s, i) => s + i.valor_total, 0);
  const buf = gerarXlsxPlanilha(`${planilha.titulo} — Seleção`, itens.results, total);

  return new Response(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="selecao.xlsx"',
    }
  });
});

app.post('/:id/bulk/json', async (c) => {
  const user = c.get('user') as JWTPayload;
  const planilha = await getPlanilha(c.env.DB, Number(c.req.param('id')));
  if (!planilha) return c.json({ error: 'Não encontrado' }, 404);
  if (!canAccess(user, planilha)) return c.json({ error: 'Sem acesso' }, 403);

  const { ids } = await c.req.json<{ ids: number[] }>();
  if (!ids?.length) return c.json({ error: 'Nenhum item' }, 400);

  const ph = ids.map(() => '?').join(',');
  const itens = await c.env.DB.prepare(
    `SELECT * FROM itens WHERE id IN (${ph}) ORDER BY ordem ASC`
  ).bind(...ids).all<ItemRow>();

  return new Response(JSON.stringify({ itens: itens.results }, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="selecao.json"',
    }
  });
});

// ── IMPORT JSON ───────────────────────────────────────────────────────────────

app.post('/:id/import/json', async (c) => {
  const user = c.get('user') as JWTPayload;
  const planilha = await getPlanilha(c.env.DB, Number(c.req.param('id')));
  if (!planilha) return c.json({ error: 'Não encontrado' }, 404);
  if (!canAccess(user, planilha)) return c.json({ error: 'Sem acesso' }, 403);

  type ItemInput = { item: string; descricao?: string; unidade?: string; quantidade?: number; valor_unitario?: number; categoria?: string };
  const body = await c.req.json<{ itens?: ItemInput[] } | ItemInput[]>();
  const list: ItemInput[] = Array.isArray(body) ? body : (body.itens ?? []);

  if (!list.length) return c.json({ error: 'Nenhum item no JSON' }, 400);
  const limited = list.slice(0, 40);

  // Resolve nomes de categoria pra ids, criando as que ainda não existem
  // (mesma paleta de cores usada na criação manual, em rotação).
  const nomesUnicos = [...new Set(
    limited.map(it => it.categoria?.trim()).filter((n): n is string => !!n)
  )];

  const catIdPorNome = new Map<string, number>();
  if (nomesUnicos.length) {
    const existentes = await c.env.DB.prepare('SELECT id, nome FROM categorias').all<{ id: number; nome: string }>();
    for (const cat of existentes.results) catIdPorNome.set(cat.nome.trim().toLowerCase(), cat.id);

    let totalCategorias = existentes.results.length;
    for (const nome of nomesUnicos) {
      const chave = nome.toLowerCase();
      if (catIdPorNome.has(chave)) continue;
      const corHex = proximaCorPalette(totalCategorias);
      const { cor_borda_hex, cor_texto_hex } = calcularVariantes(corHex);
      const r = await c.env.DB.prepare(
        'INSERT INTO categorias (nome, cor_hex, cor_borda_hex, cor_texto_hex, rotulo_oculto) VALUES (?,?,?,?,?) RETURNING id'
      ).bind(nome, corHex, cor_borda_hex, cor_texto_hex, chave).first<{ id: number }>();
      if (r) catIdPorNome.set(chave, r.id);
      totalCategorias++;
    }
  }

  const maxOrd = (await c.env.DB.prepare('SELECT COALESCE(MAX(ordem),0) AS m FROM itens WHERE planilha_id = ?')
    .bind(planilha.id).first<{ m: number }>())?.m ?? 0;

  const stmts = limited.map((it, i) => {
    const qtd = Number(it.quantidade ?? 0);
    const vu  = Number(it.valor_unitario ?? 0);
    const catId = it.categoria?.trim() ? catIdPorNome.get(it.categoria.trim().toLowerCase()) ?? null : null;
    return c.env.DB.prepare(
      'INSERT INTO itens (planilha_id, categoria_id, n, ordem, item, descricao, unidade, quantidade, valor_unitario, valor_total) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).bind(planilha.id, catId, maxOrd + i + 1, maxOrd + i + 1, it.item, it.descricao ?? null, it.unidade ?? null, qtd, vu, qtd * vu);
  });

  await c.env.DB.batch(stmts);
  await touchPlanilha(c.env.DB, planilha.id);
  return c.json({ ok: true, importados: limited.length });
});

export default app;
