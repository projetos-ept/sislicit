import { Hono } from 'hono';
import type { Env } from '../index';
import { signJWT, verifyPassword, hashPassword } from '../auth';

const app = new Hono<{ Bindings: Env }>();

app.post('/login', async (c) => {
  const { username, password } = await c.req.json<{ username: string; password: string }>();
  if (!username || !password) return c.json({ error: 'Campos obrigatórios' }, 400);

  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE username = ? AND ativo = 1'
  ).bind(username).first<{ id: number; username: string; email: string; role: string; password_hash: string }>();

  if (!user || !await verifyPassword(password, user.password_hash))
    return c.json({ error: 'Usuário ou senha inválidos' }, 401);

  const expiresIn = parseInt(c.env.JWT_EXPIRES_IN ?? '86400');
  const token = await signJWT({ id: user.id, username: user.username, role: user.role }, c.env.JWT_SECRET, expiresIn);
  return c.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// Utility: generate a hash for a password (used during initial admin setup)
app.post('/hash', async (c) => {
  const { password } = await c.req.json<{ password: string }>();
  if (!password) return c.json({ error: 'password required' }, 400);
  return c.json({ hash: await hashPassword(password) });
});

export default app;
