# SisLicit

Sistema web para montar, organizar e exportar planilhas de itens de licitação/cotação (planilhas orçamentárias com categorias, cálculo automático de totais e exportação em Excel/JSON).

- **Produção**: https://sislicit.pages.dev
- **API**: `https://sislicit-api.<seu-subdominio>.workers.dev`

## Sumário

- [Arquitetura](#arquitetura)
- [Funcionalidades](#funcionalidades)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Modelo de dados](#modelo-de-dados)
- [Autenticação e permissões](#autenticação-e-permissões)
- [Rotas da API](#rotas-da-api)
- [Setup local](#setup-local)
- [Deploy](#deploy)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Limitações conhecidas](#limitações-conhecidas)

## Arquitetura

Stack 100% serverless na Cloudflare:

```
┌─────────────────────┐        ┌──────────────────────┐        ┌────────────────┐
│  Cloudflare Pages    │──────▶│  Cloudflare Worker     │──────▶│  Cloudflare D1  │
│  sislicit.pages.dev  │  HTTP  │  sislicit-api          │  SQL   │  sislicit-db    │
│  (HTML/JS estático)  │        │  (Hono + JWT + PBKDF2) │        │  (SQLite)       │
└─────────────────────┘        └──────────────────────┘        └────────────────┘
```

- **Frontend**: HTML/JS estático (sem framework), servido pelo Cloudflare Pages.
- **API**: um único Worker (`sislicit-api`), com o framework [Hono](https://hono.dev), dividido em módulos de rota.
- **Banco**: Cloudflare D1 (SQLite gerenciado), acessado via binding `env.DB`.
- **Autenticação em 2 camadas**:
  - Senha do usuário → hash **PBKDF2** (100.000 iterações, SHA-256), via Web Crypto API nativa.
  - Sessão → **JWT** assinado com HMAC-SHA256, usando um segredo de sistema (`JWT_SECRET`) independente da senha de qualquer usuário.

Nenhuma dependência externa de criptografia/JWT — tudo via `crypto.subtle` nativo do runtime do Worker.

## Funcionalidades

- Login com usuário/senha, sessão via JWT.
- CRUD de **planilhas**: criar, renomear, duplicar (planilha + todos os itens), excluir (admin).
- CRUD de **itens** dentro de uma planilha: adicionar, editar inline, duplicar, excluir, agrupar por categoria.
- CRUD de **categorias** (cor customizável, com variantes de borda/texto calculadas automaticamente via HSV); qualquer usuário autenticado pode criar uma nova categoria direto do formulário de item.
- **Exportação**: Excel (.xlsx) e JSON, por planilha inteira ou seleção de itens.
- **Importação via JSON**, incluindo um prompt pronto (aba "Importar via IA" no Admin) para gerar esse JSON a partir do texto de um pedido/edital usando qualquer IA de texto.
- **Impressão/PDF** (`imprimir.html`): folha A4 com cabeçalho editável (logo, nome da instituição, endereço — só para a impressão, não é salvo), orientação retrato/paisagem, colunas e rodapé (data, hora, assinaturas, observações, numeração de página) opcionais via checkbox. Gera o PDF pelo diálogo nativo de impressão do navegador (`window.print()`).
- Painel **Admin**: dashboard com contadores, gestão de usuários (criar, editar, trocar senha, desativar) e categorias.
- Tema **claro/escuro**, com preferência salva no navegador.
- Conveniências de UX: busca client-side em planilhas e itens, subtotal por categoria nos chips de filtro, indicador de carregamento (skeleton) nas listagens, botões desabilitados durante requisições (evita duplo-clique), atalhos de teclado (Enter para salvar, Esc para fechar modais) e opção de mostrar/ocultar senha nos campos de login e cadastro.

## Estrutura do repositório

```
v2/
├── docs/
│   └── cloudflare-setup.md      # roteiro de setup manual no dashboard Cloudflare
├── frontend/                     # → Cloudflare Pages
│   ├── index.html                # login
│   ├── planilhas.html            # listagem de planilhas
│   ├── detalhe.html              # itens de uma planilha
│   ├── imprimir.html             # folha de impressão/PDF de uma planilha
│   ├── admin.html                # painel administrativo
│   └── assets/
│       ├── app.js                # utilitários compartilhados (auth, fetch, tema, toast)
│       └── style.css
└── worker/                       # → Cloudflare Worker (API)
    ├── wrangler.toml
    ├── schema.sql                 # DDL do D1
    ├── package.json
    └── src/
        ├── index.ts               # monta o Hono app, CORS, roteamento
        ├── auth.ts                # JWT (HMAC-SHA256) + PBKDF2 + middleware
        ├── utils.ts                # helpers (totais, formatação BRL, renumeração)
        └── routes/
            ├── auth.ts             # login, hash utilitário
            ├── planilhas.ts        # planilhas, itens, export/import
            ├── categorias.ts       # categorias
            └── admin.ts            # dashboard e gestão de usuários
```

## Modelo de dados

Ver `v2/worker/schema.sql` para o DDL completo. Resumo:

| Tabela | Campos principais |
|---|---|
| `users` | `id, username, email, password_hash, role (admin\|editor), ativo` |
| `categorias` | `id, nome, cor_hex, cor_borda_hex, cor_texto_hex, rotulo_oculto` |
| `planilhas` | `id, titulo, descricao, numero_proc, criado_por, criado_em, atualizado_em` |
| `itens` | `id, planilha_id, categoria_id, n, ordem, item, descricao, unidade, quantidade, valor_unitario, valor_total` |

## Autenticação e permissões

- Toda rota sob `/api` exige `Authorization: Bearer <jwt>`, exceto `/api/auth/*`.
- `canAccess(user, planilha)`: verdadeiro se `user.role === 'admin'` ou se o usuário é o criador da planilha (`planilha.criado_por === user.id`).
- Exclusão de **planilha** é restrita a `admin`. Exclusão/edição de **item** segue `canAccess`.
- Rotas de **categorias** (editar/excluir) e de **admin** (`/api/admin/*`) exigem `role === 'admin'`. Criar categoria (`POST /api/categorias`) é liberado para qualquer usuário autenticado.
- Um admin **não pode alterar a própria role** via `PATCH /api/admin/users/:id` (mas pode editar os próprios outros campos, incluindo senha).

## Rotas da API

Base: `/api`

### `/auth`
| Método | Rota | Descrição |
|---|---|---|
| POST | `/login` | Autentica, devolve `{ token, user }` |
| POST | `/hash` | Gera hash PBKDF2 de uma senha (uso administrativo) |

### `/planilhas`
| Método | Rota | Descrição |
|---|---|---|
| GET | `/` | Lista planilhas (todas se admin, só as próprias senão) |
| POST | `/` | Cria planilha |
| GET | `/:id` | Detalhe com itens e categorias |
| PATCH | `/:id` | Atualiza título/descrição/nº processo |
| DELETE | `/:id` | Exclui planilha e itens (admin) |
| POST | `/:id/duplicar` | Duplica planilha + todos os itens |
| POST | `/:id/itens` | Adiciona item |
| PATCH | `/:id/itens/:iid` | Edita item |
| DELETE | `/:id/itens/:iid` | Exclui item |
| POST | `/:id/itens/:iid/clonar` | Duplica item |
| POST | `/:id/agrupar` | Reordena itens por categoria |
| POST | `/:id/bulk/excluir` | Exclui itens selecionados em lote |
| GET | `/:id/export/json` | Exporta planilha em JSON |
| GET | `/:id/export/excel` | Exporta planilha em Excel |
| POST | `/:id/bulk/json` | Exporta seleção em JSON |
| POST | `/:id/bulk/xlsx` | Exporta seleção em Excel |
| POST | `/:id/import/json` | Importa itens a partir de um JSON |

### `/categorias`
| Método | Rota | Permissão |
|---|---|---|
| GET | `/` | Qualquer autenticado |
| POST | `/` | Qualquer autenticado |
| PATCH | `/:id` | Admin |
| DELETE | `/:id` | Admin (bloqueado se houver itens vinculados) |

### `/admin`
| Método | Rota | Descrição |
|---|---|---|
| GET | `/dashboard` | Contadores gerais |
| GET | `/users` | Lista usuários |
| POST | `/users` | Cria usuário |
| PATCH | `/users/:id` | Edita usuário (username, email, senha, role, ativo) |
| DELETE | `/users/:id` | Desativa usuário (soft delete) |

## Setup local

```bash
cd v2/worker
npm install
npm run dev          # wrangler dev, precisa de wrangler.toml com D1 local configurado
```

Frontend é estático — basta servir `v2/frontend/` com qualquer servidor HTTP (ou abrir os arquivos direto, ajustando `window.API_BASE` para `http://localhost:8787`).

## Deploy

### Caminho padrão (com `wrangler` e credenciais Cloudflare)

```bash
cd v2/worker
wrangler d1 execute sislicit-db --file=schema.sql --remote   # aplica schema
wrangler secret put JWT_SECRET                                 # gera com: openssl rand -base64 32
wrangler deploy                                                 # publica o Worker
```

Cloudflare Pages: conectar ao repositório, root directory `v2/frontend`, sem build command.

### Fallback sem terminal (Quick Edit do dashboard)

Quando não há `wrangler`/token disponível, dá pra publicar colando um bundle único no editor online do Worker:

```bash
npx esbuild src/index.ts \
  --bundle --format=esm --target=es2019 --platform=browser --minify --legal-comments=none \
  --outfile=worker-bundle.js
```

Pontos importantes desse caminho (detalhes completos no histórico de PRs do repositório):
- `--target=es2019` é **obrigatório** — alvos mais novos geram private class fields (`#campo`) que o validador do Quick Edit rejeita com um erro de "formato de módulo ES" enganoso.
- Bindings (D1, variáveis, secrets) sobrevivem a um deploy via Quick Edit — são configuração do Worker, não do código.
- Sempre validar com `GET /api/health` (`{ ok: true }`) antes de testar o resto.

## Variáveis de ambiente

Configuradas no Worker (dashboard → Settings → Variables):

| Nome | Tipo | Exemplo |
|---|---|---|
| `JWT_SECRET` | **Secret** | gerado com `openssl rand -base64 32` |
| `JWT_EXPIRES_IN` | Variable | `86400` (segundos) |
| `CORS_ORIGINS` | Variable | `https://sislicit.pages.dev,https://outro-dominio.com` |

No frontend, cada página HTML define `window.API_BASE` antes de carregar `app.js`, apontando para a URL real do Worker.

## Limitações conhecidas

- Ações destrutivas (excluir item/planilha/usuário) usam `confirm()` **nativo** do navegador de propósito — não é um bug, é uma trava de segurança contra automação/scripts confirmando exclusões sem um humano de fato clicar.
- O bundle de produção inclui a lib `xlsx` (SheetJS) embutida estaticamente para a exportação em Excel funcionar sem depender de `wrangler deploy`; isso deixa o bundle maior (~330KB minificado), ainda dentro dos limites do Workers.
