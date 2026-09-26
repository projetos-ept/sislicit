import { Hono } from 'hono';
import { cors } from 'hono/cors';
import authRoutes      from './routes/auth';
import planilhasRoutes from './routes/planilhas';
import categoriasRoutes from './routes/categorias';
import adminRoutes     from './routes/admin';
import { authMiddleware } from './auth';

export type Env = {
  DB: D1Database;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  CORS_ORIGINS: string;
};

const app = new Hono<{ Bindings: Env }>();

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use('/api/*', async (c, next) => {
  const allowed = (c.env.CORS_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  // Allow localhost on any port in development
  if (c.env.JWT_SECRET === 'dev') allowed.push('http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:5500');

  return cors({
    origin: (origin) => allowed.includes(origin) ? origin : null,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
    credentials: false,
  })(c, next);
});

// ── PUBLIC ────────────────────────────────────────────────────────────────────
app.route('/api/auth', authRoutes);

// ── PROTECTED ─────────────────────────────────────────────────────────────────
app.use('/api/planilhas/*', authMiddleware);
app.use('/api/categorias/*', authMiddleware);
app.use('/api/admin/*', authMiddleware);

app.route('/api/planilhas',  planilhasRoutes);
app.route('/api/categorias', categoriasRoutes);
app.route('/api/admin',      adminRoutes);

// ── HEALTH ────────────────────────────────────────────────────────────────────
app.get('/api/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }));

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Erro interno' }, 500);
});

export default app;
