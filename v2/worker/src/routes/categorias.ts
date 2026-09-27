import { Hono } from 'hono';
import type { Env } from '../index';
import type { JWTPayload } from '../auth';
import { calcularVariantes } from '../utils';

const app = new Hono<{ Bindings: Env }>();

app.get('/', async (c) => {
  const cats = await c.env.DB.prepare('SELECT * FROM categorias ORDER BY nome ASC').all();
  return c.json({ categorias: cats.results });
});

app.post('/', async (c) => {
  const { nome, cor_hex, rotulo_oculto } = await c.req.json<{ nome: string; cor_hex: string; rotulo_oculto?: string }>();
  if (!nome?.trim() || !cor_hex) return c.json({ error: 'Campos obrigatórios' }, 400);

  const { cor_borda_hex, cor_texto_hex } = calcularVariantes(cor_hex);
  const r = await c.env.DB.prepare(
    'INSERT INTO categorias (nome, cor_hex, cor_borda_hex, cor_texto_hex, rotulo_oculto) VALUES (?,?,?,?,?) RETURNING *'
  ).bind(nome.trim(), cor_hex, cor_borda_hex, cor_texto_hex, rotulo_oculto ?? nome.trim().toLowerCase())
   .first();
  return c.json({ categoria: r }, 201);
});

app.patch('/:id', async (c) => {
  const user = c.get('user') as JWTPayload;
  if (user.role !== 'admin') return c.json({ error: 'Sem permissão' }, 403);

  const id = Number(c.req.param('id'));
  const { nome, cor_hex, rotulo_oculto } = await c.req.json<{ nome?: string; cor_hex?: string; rotulo_oculto?: string }>();

  let borda: string | undefined, texto: string | undefined;
  if (cor_hex) ({ cor_borda_hex: borda, cor_texto_hex: texto } = calcularVariantes(cor_hex));

  await c.env.DB.prepare(`
    UPDATE categorias SET
      nome = COALESCE(?, nome),
      cor_hex = COALESCE(?, cor_hex),
      cor_borda_hex = COALESCE(?, cor_borda_hex),
      cor_texto_hex = COALESCE(?, cor_texto_hex),
      rotulo_oculto = COALESCE(?, rotulo_oculto)
    WHERE id = ?
  `).bind(nome ?? null, cor_hex ?? null, borda ?? null, texto ?? null, rotulo_oculto ?? null, id).run();
  return c.json({ ok: true });
});

app.delete('/:id', async (c) => {
  const user = c.get('user') as JWTPayload;
  if (user.role !== 'admin') return c.json({ error: 'Sem permissão' }, 403);

  const id = Number(c.req.param('id'));
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM itens WHERE categoria_id = ?')
    .bind(id).first<{ c: number }>();
  if ((count?.c ?? 0) > 0) return c.json({ error: 'Categoria possui itens vinculados' }, 409);

  await c.env.DB.prepare('DELETE FROM categorias WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

export default app;
