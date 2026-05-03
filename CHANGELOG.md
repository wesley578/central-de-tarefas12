# Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

## v7.0 (2026-04)
- 🚀 **Automação MeuDANFE (NF-e/CT-e)** — Novo robô (Puppeteer) para extrair chaves e baixar automaticamente PDFs e XMLs do MeuDANFE.
- 📂 **Organização de Pastas Dinâmica** — Arquivos fiscais salvos automaticamente no padrão `/{pasta_download_padrao}/fiscal/{Competência}/{CNPJ}`.
- 🔐 **Cofre Desacoplado** — Separação completa da rota do Cofre (`cofre-routes.js`) para suportar criptografia individual e modularidade de credenciais.
- 🐛 **Correção de Seletor** — Adaptação do robô para suportar a mudança de `login` para `username` no portal MeuDANFE.
- 🖥️ **Novo Painel Frontend** — Aba exclusiva de "NF-e (Captura)" com console de logs de sincronização em tempo real.

## v6.0 (2026-04)
- 🚀 **Arquitetura Modular** — Refatoração completa do `server.js` em módulos independentes (`src/routes`, `src/middleware`)
- 🏗️ **Centralização de Recursos** — Módulos dedicados para Banco de Dados (`db.js`) e Schemas de Validação (`schemas.js`)
- 🛡️ **Tratamento de Erros Global** — Novo middleware para capturar e formatar erros de API em JSON consistentemente
- 🧹 **Código Limpo** — Redução de ~80% do tamanho do ponto de entrada principal (`server.js`)

## v5.1 (2026-04)
- ✅ **Captura em Lote (Batch)** — Opção "TODAS AS EMPRESAS" para download em massa com um clique
- ✅ **Notificações Proativas** — Alertas para tarefas que vencem em 3 dias (ícone ⏳)
- ✅ **Gestor de Processos (PM2)** — API rodando 24/7 em background com suporte a acesso remoto
- ✅ **Centralização de Downloads** — Pasta global de armazenamento configurável nas Definições
- ✅ **Organização de Arquivos** — Download direto em subpastas estruturadas (Empresa/Tipo/Data)
- ✅ **Regras de Ativação** — Tarefas desativadas por padrão para novos cadastros (Controle Total)
- ✅ **Auto-fill de Usuário** — Campo de usuário do Cofre preenchido automaticamente com o CNPJ

## v3.0 (2026-04)
- ✅ **Sistema de autenticação JWT** — Login com e-mail/senha, token de 7 dias, middleware de proteção em todas as rotas
- ✅ **Hierarquia de roles** — Admin (acesso total) e Colaborador (acesso restrito a execuções e dashboard)
- ✅ **Upload de comprovantes** — Anexar PDF/imagem nas execuções, preservado no histórico ao fechar o mês
- ✅ **Cron Job de fechamento automático** — Fecha o mês automaticamente no dia 1º de cada mês à meia-noite
- ✅ **SLA de Prazo no Dashboard** — Gráfico de pizza mostrando % de tarefas entregues dentro do prazo
- ✅ **Sistema de Notificações** — Aba dedicada + sino com contador de tarefas atrasadas
- ✅ **Prazo por tarefa** — Campo `dia_vencimento` (dia do mês) em cada tarefa

## v2.0 (2026-04)
- ✅ **Variáveis de ambiente** — Suporte a `.env` para `PORT`, `DB_PATH` e `JWT_SECRET`
- ✅ **Validação Zod** — Schemas de validação em todos os endpoints de escrita
- ✅ **Paginação** — Execuções e Histórico paginados com controles de Anterior/Próxima na UI
- ✅ **Importação via CSV** — Upload de planilha de empresas com template para download

## v1.0 (2026-04)
- ✅ **Rebranding** — Renomeado de "ContaTask" para "Central de Tarefas"
- ✅ **Modularização do frontend** — CSS, JS de API e JS de app em arquivos separados
- ✅ **Configurações dinâmicas** — Nome do escritório editável pela interface
- ✅ **CRUD completo** — Empresas, Tarefas, Execuções, Histórico
- ✅ **Dashboard** — Gráficos de progresso por tarefa, empresa e categoria
- ✅ **Matriz de status** — Grid visual empresa × tarefa
- ✅ **Fechamento de mês** — Arquivamento com reset automático das execuções
