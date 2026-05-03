const crypto = require('crypto');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const fs = require('fs');

// Módulos internos
const db = require('./src/db');
const { auth, autenticar, requireAdmin } = require('./src/middleware/auth');
const errorHandler = require('./src/middleware/error-handler');

// Módulos NFS-e (Existentes)
const { encrypt, decrypt, capturarNfse } = require('./src/nfse');
const { NfseQueue }      = require('./src/nfse-queue');
const { TokenManager }   = require('./src/nfse-tokens');
const { criarRotasNfse } = require('./src/nfse-routes-v4');
const { garantirDatabase } = require('./src/notion-integration');

// Rotas Modularizadas
const authRoutes = require('./src/routes/auth-routes');
const empresaRoutes = require('./src/routes/empresa-routes');
const tarefaRoutes = require('./src/routes/tarefa-routes');
const execucaoRoutes = require('./src/routes/execucao-routes');
const dashboardRoutes = require('./src/routes/dashboard-routes');
const configRoutes = require('./src/routes/config-routes');
const historicoRoutes = require('./src/routes/historico-routes');
const notificacaoRoutes = require('./src/routes/notificacao-routes');
const mesRoutes = require('./src/routes/mes-routes');
const cofreRoutes = require('./src/routes/cofre-routes');
const fiscalRoutes = require('./src/routes/fiscal-routes');
const certificadoRoutes     = require('./src/routes/certificado-routes');
const sefazRoutes           = require('./src/routes/sefaz-routes');
const nfeDistribuicaoRoutes = require('./src/routes/nfeDistribuicao-routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Garantir pasta de uploads
if (!fs.existsSync(path.join(__dirname, 'public/uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'public/uploads'), { recursive: true });
}

// --- MIGRATIONS & INIT ---
function rodarMigracaoNfseV4(db) {
  const migPath = path.join(__dirname, 'migrations', 'nfse-v4.sql');
  if (fs.existsSync(migPath)) {
    const sql = fs.readFileSync(migPath, 'utf8');
    db.exec(sql);
    console.log('[NFS-e v4] Migração aplicada com sucesso.');
  }
}

function rodarMigracaoNotion(db) {
  const migrations = [
    "ALTER TABLE nfse_jobs ADD COLUMN duracao_ms INTEGER DEFAULT 0",
    "ALTER TABLE nfse_jobs ADD COLUMN notas_total INTEGER DEFAULT 0",
    "ALTER TABLE nfse_jobs ADD COLUMN notion_page_id TEXT",
    "ALTER TABLE nfse_jobs ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))",
    "CREATE INDEX IF NOT EXISTS idx_nfse_jobs_status ON nfse_jobs(status, updated_at DESC)",
    `CREATE TABLE IF NOT EXISTS nfse_incidentes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      detectado   TEXT    DEFAULT (datetime('now')),
      jobs_afet   INTEGER,
      duracao_s   INTEGER,
      resolvido   INTEGER DEFAULT 0,
      notion_id   TEXT
    )`
  ];
  migrations.forEach(sql => {
    try { db.exec(sql); } catch(e) { /* Coluna pode já existir */ }
  });
  console.log('[Notion] Migração verificada/aplicada.');
}

rodarMigracaoNfseV4(db);
rodarMigracaoNotion(db);

if (process.env.NOTION_API_KEY && process.env.NOTION_PARENT_PAGE_ID) {
  garantirDatabase(process.env.NOTION_PARENT_PAGE_ID).catch(err => {
    console.error('[Notion] Erro ao garantir database:', err.message);
  });
}

// Inicializa Tokens NFS-e
const nfseTokens = new TokenManager(db);
nfseTokens.iniciar();

// Adaptador NFS-e (Mantido aqui por enquanto por ser altamente acoplado ao server setup)
async function capturarNfseAdapter({ cnpj, tipo, dataInicio, dataFim, empresaId }) {
  let cred = null;
  if (empresaId) {
    cred = db.prepare('SELECT * FROM credenciais_nfse WHERE empresa_id = ?').get(empresaId);
  }
  if (!cred) {
    const cnpjLimpo = cnpj.replace(/\D/g, '');
    const emp = db.prepare("SELECT id FROM empresas WHERE replace(replace(replace(cnpj,'.',''),'/',''),'-','') = ?")
      .get(cnpjLimpo);
    if (emp) cred = db.prepare('SELECT * FROM credenciais_nfse WHERE empresa_id = ?').get(emp.id);
  }
  if (!cred) throw new Error(`Credenciais não encontradas para CNPJ ${cnpj}. Configure no Cofre NFS-e.`);

  let senha;
  try {
    senha = decrypt(cred.senha_enc, cred.iv);
  } catch (e) {
    throw new Error(`Falha ao descriptografar senha do CNPJ ${cnpj}: ${e.message}`);
  }

  const empresa = empresaId ? db.prepare('SELECT nome FROM empresas WHERE id = ?').get(empresaId) : null;
  const [tipo_nota_raw, tipo_captura_raw] = tipo ? tipo.split(':') : ['prestadas', 'lista'];
  const tipo_nota    = (['prestadas', 'tomadas'].includes(tipo_nota_raw)) ? tipo_nota_raw : 'prestadas';
  const tipo_captura = (['lista', 'xml', 'pdf'].includes(tipo_captura_raw)) ? tipo_captura_raw : 'lista';

  const cfgGlobal = db.prepare('SELECT pasta_download_padrao FROM configuracoes LIMIT 1').get();
  const downloadDirFinal = cfgGlobal?.pasta_download_padrao || cred.pasta_download || null;

  return capturarNfse({
    cnpj:         cred.usuario || cnpj,
    senha,
    tipo_nota,
    tipo_captura,
    data_inicio:  dataInicio,
    data_fim:     dataFim,
    zipar:        tipo_captura !== 'lista',
    downloadDir:  downloadDirFinal,
    pasta_fixa:   downloadDirFinal,
    empresa_nome: empresa?.nome || cnpj,
  });
}

const nfseQueue = new NfseQueue({
  db,
  capturarNfse: capturarNfseAdapter,
  maxConcorrencia: 2,
  maxTentativas:   3,
  baseDelayMs:     8000,
});
nfseQueue.iniciar();

// --- MIDDLEWARES GLOBAIS ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- ROTAS DA API ---
app.use('/api/auth', authRoutes);
app.use('/api/empresas', empresaRoutes);
app.use('/api/tarefas', tarefaRoutes);
app.use('/api/execucoes', execucaoRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/historico', historicoRoutes);
app.use('/api/notificacoes', notificacaoRoutes);
app.use('/api/mes', mesRoutes);
app.use('/api/fiscal',           fiscalRoutes);
app.use('/api/certificados',     certificadoRoutes);
app.use('/api/sefaz',            sefazRoutes);
app.use('/api/nfe-distribuicao', nfeDistribuicaoRoutes);
app.use('/api/cofre-nfse', cofreRoutes);
app.use('/api', configRoutes); // Configurações e Competência

// NFS-e v4 Rotas (Legado/Modularizado)
criarRotasNfse(app, {
  db,
  queue:       nfseQueue,
  tokens:      nfseTokens,
  autenticar,
  requireAdmin,
});

// Middleware de Erro Global (Deve ser o último)
app.use(errorHandler);

// --- CRON JOBS ---
// Fechamento automático todo dia 1º à meia-noite
cron.schedule('0 0 1 * *', async () => {
  console.log('[Cron] Iniciando fechamento automático do mês...');
  const mesAnterior = new Date();
  mesAnterior.setMonth(mesAnterior.getMonth() - 1);
  const mesRef = mesAnterior.toISOString().slice(0, 7);
  
  // Lógica simplificada de fechamento (reutilizando a lógica da rota /api/mes/fechar se necessário)
  // Por simplicidade, faremos o trigger via DB diretamente aqui se for idêntico
});

// --- SERVER START ---
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
