import { Hono } from 'hono';
import type { Env } from '../index';
import type { JWTPayload } from '../auth';
import { hashPassword } from '../auth';

const app = new Hono<{ Bindings: Env }>();

// All routes here require admin
app.use('*', async (c, next) => {
  const user = c.get('user') as JWTPayload;
  if (user?.role !== 'admin') return c.json({ error: 'Sem permissão' }, 403);
  await next();
});

app.get('/dashboard', async (c) => {
  const [planilhas, itens, categorias, unidades, usuarios] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT COUNT(*) AS c FROM planilhas'),
    c.env.DB.prepare('SELECT COUNT(*) AS c FROM itens'),
    c.env.DB.prepare('SELECT COUNT(*) AS c FROM categorias'),
    c.env.DB.prepare('SELECT COUNT(*) AS c FROM unidades'),
    c.env.DB.prepare('SELECT COUNT(*) AS c FROM users'),
  ]);
  return c.json({
    total_planilhas:  (planilhas.results[0] as { c: number }).c,
    total_itens:      (itens.results[0]     as { c: number }).c,
    total_categorias: (categorias.results[0] as { c: number }).c,
    total_unidades:   (unidades.results[0]   as { c: number }).c,
    total_usuarios:   (usuarios.results[0]  as { c: number }).c,
  });
});

// ── USERS ─────────────────────────────────────────────────────────────────────

app.get('/users', async (c) => {
  const users = await c.env.DB.prepare(
    'SELECT id, username, email, role, ativo, created_at FROM users ORDER BY created_at DESC'
  ).all();
  return c.json({ users: users.results });
});

app.post('/users', async (c) => {
  const { username, email, password, role } = await c.req.json<{ username: string; email: string; password: string; role?: string }>();
  if (!username || !email || !password) return c.json({ error: 'Campos obrigatórios' }, 400);

  const hash = await hashPassword(password);
  const r = await c.env.DB.prepare(
    'INSERT INTO users (username, email, password_hash, role) VALUES (?,?,?,?) RETURNING id, username, email, role, ativo, created_at'
  ).bind(username.trim(), email.trim(), hash, role === 'admin' ? 'admin' : 'editor').first();
  return c.json({ user: r }, 201);
});

app.patch('/users/:id', async (c) => {
  const me = c.get('user') as JWTPayload;
  const id = Number(c.req.param('id'));
  const { username, email, role, ativo, password } = await c.req.json<{ username?: string; email?: string; role?: string; ativo?: boolean; password?: string }>();

  let hash: string | null = null;
  if (password) hash = await hashPassword(password);

  if (role !== undefined && id === me.id) {
    const current = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(id).first<{ role: string }>();
    if (current && role !== current.role) return c.json({ error: 'Não é possível alterar sua própria role' }, 400);
  }

  await c.env.DB.prepare(`
    UPDATE users SET
      username = COALESCE(?, username),
      email = COALESCE(?, email),
      role = COALESCE(?, role),
      ativo = COALESCE(?, ativo),
      password_hash = COALESCE(?, password_hash)
    WHERE id = ?
  `).bind(username ?? null, email ?? null,
      role === 'admin' || role === 'editor' ? role : null,
      ativo !== undefined ? (ativo ? 1 : 0) : null,
      hash, id).run();
  return c.json({ ok: true });
});

app.delete('/users/:id', async (c) => {
  const me = c.get('user') as JWTPayload;
  const id = Number(c.req.param('id'));
  if (id === me.id) return c.json({ error: 'Não é possível desativar sua própria conta' }, 400);
  await c.env.DB.prepare('UPDATE users SET ativo = 0 WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

export default app;
