import { Hono } from 'hono';
import type { Env } from '../index';
import type { JWTPayload } from '../auth';

const app = new Hono<{ Bindings: Env }>();

app.get('/', async (c) => {
  const unidades = await c.env.DB.prepare('SELECT * FROM unidades ORDER BY nome ASC').all();
  return c.json({ unidades: unidades.results });
});

app.post('/', async (c) => {
  const { nome } = await c.req.json<{ nome: string }>();
  if (!nome?.trim()) return c.json({ error: 'Nome obrigatório' }, 400);

  const existente = await c.env.DB.prepare('SELECT * FROM unidades WHERE LOWER(nome) = LOWER(?)')
    .bind(nome.trim()).first();
  if (existente) return c.json({ unidade: existente }, 200);

  const r = await c.env.DB.prepare('INSERT INTO unidades (nome) VALUES (?) RETURNING *')
    .bind(nome.trim()).first();
  return c.json({ unidade: r }, 201);
});

app.patch('/:id', async (c) => {
  const user = c.get('user') as JWTPayload;
  if (user.role !== 'admin') return c.json({ error: 'Sem permissão' }, 403);

  const id = Number(c.req.param('id'));
  const { nome } = await c.req.json<{ nome?: string }>();
  if (!nome?.trim()) return c.json({ error: 'Nome obrigatório' }, 400);

  await c.env.DB.prepare('UPDATE unidades SET nome = ? WHERE id = ?').bind(nome.trim(), id).run();
  return c.json({ ok: true });
});

app.delete('/:id', async (c) => {
  const user = c.get('user') as JWTPayload;
  if (user.role !== 'admin') return c.json({ error: 'Sem permissão' }, 403);

  const id = Number(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM unidades WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

export default app;
