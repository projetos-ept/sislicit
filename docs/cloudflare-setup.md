# Guia de Setup Cloudflare — SisLicit v2
## Para uso com extensão Claude no Chrome (clique automático)

Este roteiro foi escrito para que a extensão do Claude no Chrome execute cada passo clicando na interface do Cloudflare.  
**A extensão deve parar automaticamente nos passos marcados com 🔐** — esses exigem que você digite a informação secreta.

---

## Pré-requisito: conta Cloudflare

- URL: https://dash.cloudflare.com
- Crie uma conta gratuita se não tiver

---

## PARTE 1 — Criar o banco D1

1. Acesse https://dash.cloudflare.com
2. No menu lateral esquerdo, clique em **Workers & Pages**
3. Clique na aba **D1 SQL Database**
4. Clique no botão azul **Create database**
5. No campo **Database name** digite: `sislicit-db`
6. Clique em **Create**
7. Aguarde a criação (pode levar ~5 segundos)
8. Você será levado à página do banco — **copie o Database ID** (formato `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
9. Cole o Database ID no arquivo `v2/worker/wrangler.toml`, campo `database_id`

---

## PARTE 2 — Rodar o schema SQL

Na mesma página do banco D1 criado:

1. Clique na aba **Console**
2. Você verá um editor SQL
3. Cole o conteúdo de `v2/worker/schema.sql` no editor
4. Clique em **Execute**
5. Confirme que retorna `"Done"` sem erros

---

## PARTE 3 — Criar o Worker (API)

1. No menu lateral, clique em **Workers & Pages**
2. Clique em **Create** → **Create Worker**
3. No campo de nome digite: `sislicit-api`
4. Clique em **Deploy** (código temporário — será substituído pelo wrangler)
5. Clique em **Configure Worker** (ou acesse o Worker pelo nome)
6. Vá em **Settings** → **Variables**
7. Em **Environment Variables** (não secret), clique **Add variable**:
   - Name: `CORS_ORIGINS`  
     Value: `https://sislicit.pages.dev,https://pan-xls.pages.dev,https://projetos-ept.github.io`
   - Clique **Save**
8. Adicione outra variável:
   - Name: `JWT_EXPIRES_IN`  
     Value: `86400`
   - Clique **Save**

### 🔐 PARE AQUI — JWT Secret (você digita)

9. Ainda em **Settings** → **Variables**
10. Clique em **Add variable** em **Secrets** (seção separada, com cadeado)
11. Name: `JWT_SECRET`
12. Value: **digite uma senha forte** — ex.: `sislicit-2026-producao-chave-segura` ou qualquer string aleatória com 32+ caracteres
13. Clique **Save and deploy**

---

## PARTE 4 — Vincular D1 ao Worker

1. Ainda no Worker `sislicit-api`, vá em **Settings** → **Bindings**
2. Clique **Add** → **D1 Database**
3. Variable name: `DB`
4. D1 database: selecione `sislicit-db` no dropdown
5. Clique **Save**

---

## PARTE 5 — Deploy do Worker via Wrangler (terminal local)

> Este passo é feito uma vez no terminal, não pela extensão.

```bash
cd v2/worker
npm install
wrangler deploy
```

Se pedir login: `wrangler login` → abre navegador → autorize.

---

## PARTE 6 — Criar o projeto Pages (frontend)

1. No menu lateral, clique em **Workers & Pages**
2. Clique em **Create** → **Pages** → **Connect to Git**
3. Conecte sua conta GitHub se necessário
4. Selecione o repositório `projetos-ept/sislicit`
5. Configurações de build:
   - **Project name**: `sislicit`
   - **Production branch**: `main`
   - **Root directory**: `v2/frontend`
   - **Build command**: *(deixe vazio — arquivos estáticos)*
   - **Build output directory**: `/` *(ou deixe padrão)*
6. Clique **Save and Deploy**
7. Aguarde o primeiro deploy (~30 segundos)
8. O projeto ficará em `https://sislicit.pages.dev`

> Se `sislicit` já estiver tomado, use `pan-xls` → ficará em `https://pan-xls.pages.dev`

---

## PARTE 7 — Atualizar a URL da API no frontend

Depois de saber a URL do Worker (ex.: `https://sislicit-api.projetos-ept.workers.dev`):

1. Edite os 4 arquivos HTML em `v2/frontend/`:
   - `index.html`, `planilhas.html`, `detalhe.html`, `admin.html`
2. Troque a linha:
   ```html
   <script>window.API_BASE = 'https://sislicit-api.projetos-ept.workers.dev';</script>
   ```
   pela URL real do seu Worker (visível no painel Cloudflare → Workers → `sislicit-api` → URL)
3. Commit e push → Pages faz novo deploy automático

---

## PARTE 8 — Criar o primeiro usuário admin

O banco começa vazio. Crie o admin via curl (rode no terminal):

```bash
# 1. Gere o hash da sua senha
curl -X POST https://sislicit-api.projetos-ept.workers.dev/api/auth/hash \
  -H "Content-Type: application/json" \
  -d '{"password":"SUA_SENHA_AQUI"}'
# → retorna { "hash": "xxxxxxxx:xxxxxxxx" }

# 2. Insira no banco via wrangler D1
wrangler d1 execute sislicit-db --remote --command "
INSERT INTO users (username, email, password_hash, role) VALUES (
  'admin',
  'seu@email.com',
  'COLE_O_HASH_AQUI',
  'admin'
);"
```

### 🔐 PARE AQUI — senha do admin (você digita nos campos acima)

---

## PARTE 9 — Teste final

1. Acesse `https://sislicit.pages.dev` (ou `pan-xls.pages.dev`)
2. Faça login com `admin` / sua senha
3. Crie uma planilha de teste
4. Verifique que salva, exporta Excel e JSON funcionam

---

## Resumo de URLs

| Serviço | URL |
|---------|-----|
| Frontend | `https://sislicit.pages.dev` |
| API Worker | `https://sislicit-api.projetos-ept.workers.dev` |
| D1 Console | `https://dash.cloudflare.com` → D1 → `sislicit-db` → Console |

---

## CORS configurado para

- `https://sislicit.pages.dev`
- `https://pan-xls.pages.dev`
- `https://projetos-ept.github.io`

Se adicionar outro domínio, atualize a variável `CORS_ORIGINS` no Worker.
