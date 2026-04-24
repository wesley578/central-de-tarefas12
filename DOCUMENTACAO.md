# Central de Tarefas — Documentação Completa da API

> API REST de controle de tarefas mensais para escritórios de contabilidade.
> Stack: **Node.js + Express + SQLite (better-sqlite3)** · Dashboard web embutido · Autenticação JWT.

---

## Sumário

1. [Visão Geral](#visão-geral)
2. [Como rodar](#como-rodar)
3. [Banco de Dados](#banco-de-dados)
4. [Autenticação](#autenticação)
5. [Endpoints](#endpoints)
   - [Auth](#auth)
   - [Configurações](#configurações)
   - [Empresas](#empresas)
   - [Tarefas](#tarefas)
   - [Execuções](#execuções)
   - [Fechar Mês](#fechar-mês)
   - [Histórico](#histórico)
   - [Notificações](#notificações)
   - [Dashboard](#dashboard)
6. [Regras de negócio](#regras-de-negócio)
7. [Status válidos](#status-válidos)
8. [Dados de exemplo (seed)](#dados-de-exemplo-seed)
9. [Dashboard web](#dashboard-web)
10. [Decisões de arquitetura](#decisões-de-arquitetura)
11. [Changelog](#changelog)

---

## Visão Geral

O Central de Tarefas controla tarefas mensais recorrentes de um escritório de contabilidade, associando cada tarefa a cada empresa cliente. O ciclo funciona assim:

1. Cadastra-se empresas e tarefas (templates).
2. Para cada empresa, define-se quais tarefas se aplicam (habilitadas/desabilitadas).
3. O mês corrente é operado via **Execuções** — cada execução é uma tarefa × empresa com campos de registro.
4. Ao final do mês, executa-se o **fechamento** — as execuções são arquivadas no **Histórico** e o mês corrente é resetado. O fechamento também ocorre automaticamente todo dia 1º via **Cron Job**.
5. O **Dashboard** mostra percentuais de conclusão por tarefa, empresa e categoria, e métricas de qualidade de entrega (SLA de Prazo).

---

## Como rodar

### Pré-requisitos

- Node.js **v20 LTS ou superior** (recomendado: v22 LTS)
  - ⚠️ Node.js v24+ requer `better-sqlite3` v11+. Este projeto já usa v11.
- macOS, Linux ou Windows

### Instalação

```bash
# 1. Extrair o ZIP
unzip taskapi.zip
cd taskapi

# 2. Instalar dependências
npm install

# 3. Configurar variáveis de ambiente
# Crie um arquivo .env na raiz do projeto contendo:
# PORT=3000
# DB_PATH=./tarefas.db
# JWT_SECRET=sua_chave_secreta_aqui

# 4. Iniciar o servidor
node server.js
```

### Acessar

| Recurso | URL |
|---|---|
| Dashboard web | http://localhost:3000 |
| API base | http://localhost:3000/api |

### Credenciais padrão (primeiro acesso)

| Campo | Valor |
|---|---|
| E-mail | admin@admin.com |
| Senha | 123456 |

> ⚠️ Altere a senha padrão após o primeiro login em produção.

### Banco de dados

O arquivo `tarefas.db` (SQLite) é criado automaticamente na primeira execução no diretório raiz do projeto. Dados de exemplo são inseridos automaticamente se o banco estiver vazio.

---

## Banco de Dados

### Tabelas

#### `usuarios`
Usuários do sistema com controle de hierarquia.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | INTEGER PK | Auto-incremento |
| `nome` | TEXT NOT NULL | Nome completo |
| `email` | TEXT UNIQUE | E-mail de acesso |
| `senha_hash` | TEXT | Senha criptografada com bcrypt |
| `role` | TEXT | `admin` ou `colaborador` (padrão: colaborador) |
| `criado_em` | TEXT | Timestamp de criação |

#### `configuracoes`
Configurações globais do sistema.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | INTEGER PK | Auto-incremento |
| `nome_escritorio` | TEXT | Nome de exibição do escritório |

#### `empresas`
Clientes do escritório.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | INTEGER PK | Auto-incremento |
| `nome` | TEXT NOT NULL | Razão social ou nome fantasia |
| `cnpj` | TEXT | CNPJ ou CPF (sem formatação forçada) |
| `regime` | TEXT | SIMPLES, MEI, PRESUMIDO, REAL ou CEI |
| `ativo` | INTEGER | 1 = ativa, 0 = inativa (padrão: 1) |
| `criado_em` | TEXT | Timestamp de criação |

#### `tarefas`
Templates de tarefas mensais recorrentes.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | INTEGER PK | Auto-incremento |
| `nome` | TEXT NOT NULL | Nome da tarefa |
| `categoria` | TEXT | Fiscal, Contábil, Dep. Pessoal, Obrigações Acessórias, Administrativo |
| `descricao` | TEXT | Descrição detalhada opcional |
| `dia_vencimento` | INTEGER | Dia do mês limite para conclusão (1–31) |
| `criado_em` | TEXT | Timestamp de criação |

#### `empresa_tarefas`
Relacionamento muitos-para-muitos que define quais tarefas cada empresa deve executar.

| Campo | Tipo | Descrição |
|---|---|---|
| `empresa_id` | INTEGER FK | Referência a `empresas.id` |
| `tarefa_id` | INTEGER FK | Referência a `tarefas.id` |
| `ativo` | INTEGER | 1 = habilitada, 0 = não se aplica |

> **Importante:** Esta tabela é a fonte de verdade para o Dashboard. Métricas consideram somente tarefas com `ativo = 1` para cada empresa.

#### `execucoes`
Registros do mês corrente — uma linha por empresa × tarefa habilitada.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | INTEGER PK | Auto-incremento |
| `empresa_id` | INTEGER FK | Referência a `empresas.id` |
| `tarefa_id` | INTEGER FK | Referência a `tarefas.id` |
| `status` | TEXT | pendente / em_andamento / concluida / bloqueada |
| `o_que_foi_feito` | TEXT | Descrição do trabalho realizado |
| `quando` | TEXT | Data de execução (YYYY-MM-DD) |
| `observacoes` | TEXT | Anotações livres |
| `responsavel` | TEXT | Preenchido automaticamente com o nome do usuário logado |
| `comprovante` | TEXT | Nome do arquivo de comprovante (salvo em `/public/uploads/`) |
| `criado_em` | TEXT | Timestamp de criação |
| `atualizado_em` | TEXT | Timestamp da última atualização |

> Constraint `UNIQUE(empresa_id, tarefa_id)` garante uma linha por par.

#### `historico`
Arquivo imutável de execuções passadas. Cada fechamento de mês grava um snapshot completo aqui.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | INTEGER PK | Auto-incremento |
| `empresa_id` | INTEGER | ID da empresa (pode ser NULL se empresa foi removida) |
| `tarefa_id` | INTEGER | ID da tarefa (pode ser NULL se tarefa foi removida) |
| `empresa_nome` | TEXT NOT NULL | Nome desnormalizado (preservado mesmo se empresa for deletada) |
| `tarefa_nome` | TEXT NOT NULL | Nome desnormalizado |
| `categoria` | TEXT | Categoria da tarefa no momento do fechamento |
| `mes_referencia` | TEXT | Formato YYYY-MM (ex: 2026-04) |
| `o_que_foi_feito` | TEXT | Descrição copiada da execução |
| `quando` | TEXT | Data copiada da execução |
| `observacoes` | TEXT | Observações copiadas |
| `status` | TEXT | Status no momento do fechamento |
| `responsavel` | TEXT | Responsável copiado |
| `comprovante` | TEXT | Nome do arquivo de comprovante copiado |
| `arquivado_em` | TEXT | Timestamp do fechamento |

> Os campos `empresa_nome` e `tarefa_nome` são desnormalizados intencionalmente para preservar o histórico mesmo que a empresa ou tarefa seja removida futuramente.

---

## Autenticação

Todas as rotas da API (exceto `/api/auth/login`) exigem um **JWT Bearer Token** no header:

```
Authorization: Bearer <token>
```

O token é obtido via `POST /api/auth/login` e tem validade de **7 dias**.

### Hierarquia de Permissões

| Role | Acesso |
|---|---|
| `admin` | Acesso total a todas as rotas e telas |
| `colaborador` | Acesso apenas a Dashboard, Execuções, Histórico e Notificações |

> Quando um colaborador registra uma execução, o campo `responsavel` é preenchido automaticamente com o nome do usuário logado.

---

## Endpoints

### Auth

#### `POST /api/auth/login`
Autentica o usuário e retorna um JWT.

**Body:**
```json
{ "email": "admin@admin.com", "senha": "123456" }
```

**Resposta:**
```json
{
  "token": "eyJhbG...",
  "user": { "id": 1, "nome": "Administrador", "role": "admin" }
}
```

---

#### `GET /api/auth/me`
Retorna os dados do usuário autenticado (requer token).

---

### Configurações

#### `GET /api/configuracoes`
Retorna as configurações atuais (nome do escritório). Requer role `admin`.

#### `PUT /api/configuracoes`
Atualiza o nome do escritório. Requer role `admin`.

**Body:**
```json
{ "nome_escritorio": "Novo Nome de Escritório" }
```

---

### Empresas

> Todas as rotas de Empresas requerem role `admin`.

#### `GET /api/empresas`
Lista todas as empresas.

**Query params:**
- `?ativo=1` — filtra apenas ativas
- `?ativo=0` — filtra apenas inativas

#### `GET /api/empresas/:id`
Retorna empresa com suas tarefas e flag de habilitação.

#### `POST /api/empresas`
Cadastra uma nova empresa. Validação via **Zod**.

**Body:**
```json
{
  "nome": "Padaria Estrela LTDA",
  "cnpj": "12.345.678/0001-90",
  "regime": "SIMPLES",
  "tarefas_ids": [1, 2, 3]
}
```

#### `POST /api/empresas/import`
Importa empresas em lote via JSON (originado de CSV).

**Body:** Array de objetos com `nome`, `cnpj`, `regime`.

#### `PUT /api/empresas/:id`
Atualiza dados de uma empresa. Validação via **Zod**.

#### `DELETE /api/empresas/:id`
Remove empresa (cascata: execuções e vínculos são removidos).

---

### Tarefas

> Todas as rotas de Tarefas requerem role `admin`.

#### `GET /api/tarefas`
Lista todas as tarefas.

**Query params:**
- `?categoria=Fiscal`

#### `GET /api/tarefas/:id`
Retorna uma tarefa pelo ID.

#### `POST /api/tarefas`
Cadastra uma nova tarefa. Validação via **Zod**.

**Body:**
```json
{
  "nome": "Folha de Pagamento",
  "categoria": "Dep. Pessoal",
  "descricao": "Processamento e envio da folha",
  "dia_vencimento": 5
}
```

#### `PUT /api/tarefas/:id`
Atualiza uma tarefa. Validação via **Zod**.

#### `DELETE /api/tarefas/:id`
Remove uma tarefa.

---

### Execuções

> Rotas de leitura e atualização requerem token (qualquer role). Reset requer `admin`.

#### `GET /api/execucoes`
Lista execuções do mês corrente com filtros e **paginação**.

**Query params:**
- `?empresa_id=1`
- `?tarefa_id=3`
- `?status=concluida`
- `?categoria=Fiscal`
- `?page=1` (página atual, padrão: 1)
- `?limit=50` (itens por página, padrão: 50)

**Resposta (Paginada):**
```json
{ "data": [...], "total": 120, "page": 1, "limit": 50 }
```

#### `GET /api/execucoes/:id`
Retorna uma execução pelo ID, com nome da empresa e tarefa.

#### `PUT /api/execucoes/:id`
Atualiza os campos de uma execução. Validação via **Zod**. O campo `responsavel` é preenchido automaticamente com o usuário logado.

**Body:**
```json
{
  "status": "concluida",
  "o_que_foi_feito": "DAS emitido e enviado ao cliente via WhatsApp",
  "quando": "2026-04-20",
  "observacoes": "Cliente confirmou recebimento"
}
```

#### `POST /api/execucoes/:id/comprovante`
Upload de arquivo comprovante (PDF, JPG, PNG) via `multipart/form-data`.

**Form field:** `comprovante` (arquivo)

O arquivo é salvo em `public/uploads/` e o nome é armazenado no banco.

#### `POST /api/execucoes/reset`
Reseta todas as execuções de uma empresa para `pendente`. Requer role `admin`.

**Body:** `{ "empresa_id": 1 }`

---

### Fechar Mês

#### `POST /api/mes/fechar`
Arquiva todas as execuções no histórico e reseta o mês. Requer role `admin`.

**Body:** `{ "mes_referencia": "2026-04" }`

> O fechamento também ocorre automaticamente todo dia 1º à meia-noite via **Cron Job** (node-cron).

---

### Histórico

#### `GET /api/historico/meses`
Lista meses disponíveis no histórico.

#### `GET /api/historico/resumo`
Resumo estatístico por mês (total, concluídas, pendentes, etc.).

#### `GET /api/historico`
Lista registros do histórico com filtros e **paginação**.

**Query params:**
- `?mes_referencia=2026-04`
- `?empresa_id=1`
- `?status=concluida`
- `?categoria=Contábil`
- `?page=1`
- `?limit=50`

**Resposta (Paginada):**
```json
{ "data": [...], "total": 540, "page": 1, "limit": 50 }
```

#### `PUT /api/historico/:id`
Edita um registro do histórico. Mesmos campos de execução.

---

### Notificações

#### `GET /api/notificacoes`
Retorna lista de tarefas atrasadas (execuções não concluídas cujo `dia_vencimento` da tarefa é menor ou igual ao dia atual do mês).

**Resposta:**
```json
[
  {
    "id": 15,
    "empresa_nome": "Padaria Estrela LTDA",
    "tarefa_nome": "Folha de Pagamento",
    "dia_vencimento": 5
  }
]
```

---

### Dashboard

#### `GET /api/dashboard`
Retorna resumo completo: totais, por tarefa, por empresa, por categoria e atividades recentes.

#### `GET /api/dashboard/matrix`
Retorna a matriz de status (empresa × tarefa) para visualização em grid.

#### `GET /api/dashboard/sla`
Retorna métricas de qualidade de entrega (SLA de Prazo).

**Resposta:**
```json
{ "no_prazo": 42, "atrasadas": 8, "total": 50 }
```

---

## Regras de negócio

- Ao cadastrar uma tarefa nova, ela é automaticamente vinculada a todas as empresas ativas com `ativo=1` em `empresa_tarefas` e uma execução `pendente` é criada para cada.
- Ao cadastrar uma empresa, todas as tarefas existentes são vinculadas a ela por padrão (podem ser desabilitadas depois).
- O Dashboard considera apenas vínculos com `ativo=1` em `empresa_tarefas`.
- O campo `responsavel` em execuções é preenchido automaticamente com o nome do usuário autenticado que fez o `PUT`.
- Comprovantes são preservados no histórico ao fechar o mês.
- As notificações são calculadas **dinamicamente** — ao concluir uma tarefa, ela some das notificações automaticamente.

---

## Status válidos

| Valor | Descrição |
|---|---|
| `pendente` | Ainda não iniciada |
| `em_andamento` | Em execução |
| `concluida` | Finalizada |
| `bloqueada` | Impedida por dependência externa |

---

## Dados de exemplo (seed)

Inseridos automaticamente na primeira execução se o banco estiver vazio:

**Empresas:** Padaria Estrela LTDA (SIMPLES), TechFix Soluções ME (SIMPLES), Transportes Rota Sul (PRESUMIDO), Maria das Flores MEI (MEI), Construtora Alvorada (REAL).

**Tarefas por categoria:**
- **Fiscal:** Escrituração Fiscal Mensal, Apuração de Impostos (DAS), Conferência de Faturamento
- **Contábil:** Lançamentos Contábeis, Conciliação Bancária
- **Dep. Pessoal:** Folha de Pagamento, Recolhimento do FGTS, Envio de Eventos e-Social
- **Obrigações Acessórias:** PGDAS-D (Simples Nacional), Verificação de Certidões
- **Administrativo:** Cobrança de Honorários, Envio de Fechamentos ao Cliente

**Usuário padrão:** `admin@admin.com` / senha `123456` (role: admin)

---

## Dashboard web

Interface SPA (Single Page Application) servida em `http://localhost:3000`. Seções:

| Aba | Acesso | Descrição |
|---|---|---|
| Dashboard | Todos | Gráficos de progresso, SLA de prazo, atividades recentes |
| Matriz | Todos | Grid empresa × tarefa com status colorido |
| Execuções | Todos | Lista paginada com filtros e upload de comprovantes |
| Histórico | Todos | Arquivo mensal paginado com filtros |
| Empresas | Admin | CRUD + importação via CSV |
| Tarefas | Admin | CRUD com campo de prazo (dia de vencimento) |
| Notificações | Todos | Alertas de tarefas atrasadas com link direto para execução |
| Configurações | Admin | Nome do escritório exibido no sistema |

> **Sino 🔔:** Indicador visual no topo da aplicação mostra a contagem de tarefas atrasadas em tempo real.

---

## Decisões de arquitetura

**Por que SQLite?**
Para um escritório de contabilidade com dezenas de empresas e centenas de tarefas mensais, SQLite é mais que suficiente, elimina a necessidade de um servidor de banco de dados separado e simplifica backup (copiar um único arquivo `.db`).

**Por que .env?**
Para evitar expor credenciais e portas diretamente no código, facilitando a implantação em servidores remotos ou plataformas de nuvem. O `JWT_SECRET` deve sempre ser definido no `.env` em produção.

**Validação com Zod**
A API conta com schemas de validação (`Zod`) para garantir a integridade dos dados recebidos nas requisições POST e PUT, prevenindo inserção de dados inválidos ou manipulação direta.

**Autenticação JWT (stateless)**
Tokens JWT eliminam a necessidade de sessões no servidor. O token carrega o `id`, `nome` e `role` do usuário, permitindo validação e controle de acesso sem consultas extras ao banco.

**Uploads locais (multer)**
Comprovantes são armazenados localmente em `public/uploads/`. Em uma implantação em nuvem, recomenda-se migrar para armazenamento de objetos (ex: AWS S3, Cloudflare R2).

**Cron Job para fechamento automático**
O pacote `node-cron` agenda o fechamento do mês para `0 0 1 * *` (meia-noite do dia 1). O botão manual de fechamento continua disponível como contingência para o Admin.

**Paginação em Execuções e Histórico**
Tabelas que crescem com o tempo (execuções e histórico) retornam dados paginados (`LIMIT`/`OFFSET`) garantindo performance mesmo com anos de dados acumulados.

**Arquitetura do Frontend**
O frontend foi extraído do `index.html` monolítico para arquivos separados: `public/css/style.css` (estilos), `public/js/api.js` (cliente HTTP + JWT) e `public/js/app.js` (lógica de interface e navegação).

**Por que desnormalizar nomes no histórico?**
Para garantir integridade histórica. Se uma empresa for renomeada ou removida, os registros passados continuam legíveis com o nome original.

**Por que `COALESCE` nos UPDATEs?**
Permite atualizações parciais via API — enviar apenas os campos que mudaram sem sobrescrever os demais com `null`.

---

## Changelog

### v3.0 (2026-04)
- ✅ **Sistema de autenticação JWT** — Login com e-mail/senha, token de 7 dias, middleware de proteção em todas as rotas
- ✅ **Hierarquia de roles** — Admin (acesso total) e Colaborador (acesso restrito a execuções e dashboard)
- ✅ **Upload de comprovantes** — Anexar PDF/imagem nas execuções, preservado no histórico ao fechar o mês
- ✅ **Cron Job de fechamento automático** — Fecha o mês automaticamente no dia 1º de cada mês à meia-noite
- ✅ **SLA de Prazo no Dashboard** — Gráfico de pizza mostrando % de tarefas entregues dentro do prazo
- ✅ **Sistema de Notificações** — Aba dedicada + sino com contador de tarefas atrasadas
- ✅ **Prazo por tarefa** — Campo `dia_vencimento` (dia do mês) em cada tarefa

### v2.0 (2026-04)
- ✅ **Variáveis de ambiente** — Suporte a `.env` para `PORT`, `DB_PATH` e `JWT_SECRET`
- ✅ **Validação Zod** — Schemas de validação em todos os endpoints de escrita
- ✅ **Paginação** — Execuções e Histórico paginados com controles de Anterior/Próxima na UI
- ✅ **Importação via CSV** — Upload de planilha de empresas com template para download

### v1.0 (2026-04)
- ✅ **Rebranding** — Renomeado de "ContaTask" para "Central de Tarefas"
- ✅ **Modularização do frontend** — CSS, JS de API e JS de app em arquivos separados
- ✅ **Configurações dinâmicas** — Nome do escritório editável pela interface
- ✅ **CRUD completo** — Empresas, Tarefas, Execuções, Histórico
- ✅ **Dashboard** — Gráficos de progresso por tarefa, empresa e categoria
- ✅ **Matriz de status** — Grid visual empresa × tarefa
- ✅ **Fechamento de mês** — Arquivamento com reset automático das execuções
