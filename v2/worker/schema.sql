-- SisLicit v2 — D1 Schema
-- Run: wrangler d1 execute sislicit-db --file=schema.sql --remote

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    UNIQUE NOT NULL,
  email         TEXT    UNIQUE NOT NULL,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'editor' CHECK(role IN ('admin', 'editor')),
  ativo         INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categorias (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  nome           TEXT    NOT NULL,
  cor_hex        TEXT    NOT NULL DEFAULT '#BFDBFE',
  cor_borda_hex  TEXT    NOT NULL DEFAULT '#77A2D8',
  cor_texto_hex  TEXT    NOT NULL DEFAULT '#31598B',
  rotulo_oculto  TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS planilhas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo      TEXT    NOT NULL,
  descricao   TEXT,
  numero_proc TEXT,
  criado_por  INTEGER NOT NULL REFERENCES users(id),
  criado_em   TEXT    NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT  NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS unidades (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT    NOT NULL UNIQUE
);

INSERT OR IGNORE INTO unidades (nome) VALUES
  ('Unidade'), ('Caixa'), ('Pacote'), ('Kit'), ('Frasco'), ('Galão'), ('Bandeja');

CREATE TABLE IF NOT EXISTS itens (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  planilha_id    INTEGER NOT NULL REFERENCES planilhas(id) ON DELETE CASCADE,
  categoria_id   INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
  n              INTEGER NOT NULL,
  ordem          INTEGER NOT NULL,
  item           TEXT    NOT NULL,
  descricao      TEXT,
  unidade        TEXT,
  quantidade     REAL    NOT NULL DEFAULT 0,
  valor_unitario REAL    NOT NULL DEFAULT 0,
  valor_total    REAL    NOT NULL DEFAULT 0
);

-- Seed: default admin (senha: admin123 — TROQUE em produção)
-- hash gerado com PBKDF2-SHA256 para "admin123"
-- Para gerar novo hash use: POST /api/auth/hash { "password": "..." }
