# Central de Tarefas

> Sistema de gestão de tarefas mensais para escritórios de contabilidade.

---

## Stack

- **Backend:** Node.js + Express + SQLite (`better-sqlite3`)
- **Autenticação:** JWT (`jsonwebtoken` + `bcryptjs`)
- **Validação:** Zod
- **Upload de arquivos:** Multer
- **Agendamento:** node-cron
- **Frontend:** HTML + CSS + JS (Vanilla SPA)

---

## Instalação

```bash
# 1. Instalar dependências
npm install

# 2. Criar arquivo de variáveis de ambiente
cp .env.example .env
# Edite o .env com sua chave JWT antes de iniciar

# 3. Iniciar o servidor
node server.js
```

Acesse em: **http://localhost:3000**

**Credenciais padrão:**
- E-mail: `admin@admin.com`
- Senha: `123456`

> ⚠️ Altere a senha padrão após o primeiro acesso em produção.

---

## Funcionalidades

- ✅ Login com JWT e hierarquia de usuários (Admin / Colaborador)
- ✅ Cadastro e importação de empresas via CSV
- ✅ Templates de tarefas com prazo (dia de vencimento no mês)
- ✅ Controle de execuções mensais por empresa × tarefa
- ✅ Upload de comprovantes (PDF / imagem) por execução
- ✅ Notificações de tarefas atrasadas com sino indicador
- ✅ Fechamento de mês manual + Cron Job automático (todo dia 1º)
- ✅ Dashboard com gráficos + SLA de qualidade de entrega
- ✅ Matriz visual de status (empresa × tarefa)
- ✅ Histórico paginado com arquivo mensal imutável
- ✅ Validação de dados com Zod em todas as rotas de escrita
- ✅ Paginação em Execuções e Histórico

Consulte [DOCUMENTACAO.md](./DOCUMENTACAO.md) para a referência completa da API.
