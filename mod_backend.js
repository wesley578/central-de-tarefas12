const fs = require('fs');

let code = fs.readFileSync('server.js', 'utf8');

// 1. IMPORTS & JWT SECRET
const newImports = `
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const cron = require('node-cron');
const fsNode = require('fs');
if (!fsNode.existsSync(path.join(__dirname, 'public/uploads'))) {
  fsNode.mkdirSync(path.join(__dirname, 'public/uploads'), { recursive: true });
}

const JWT_SECRET = process.env.JWT_SECRET || 'super_secreto_key';

const auth = (roles = []) => (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ erro: 'Acesso negado' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    if (roles.length && !roles.includes(decoded.role)) return res.status(403).json({ erro: 'Proibido' });
    next();
  } catch (e) {
    res.status(401).json({ erro: 'Token inválido' });
  }
};

const upload = multer({ dest: path.join(__dirname, 'public/uploads/') });
`;
code = code.replace("const app = express();", newImports + "\nconst app = express();");


// 2. MIGRATIONS & SCHEMA
const newSchema = `
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    senha_hash TEXT NOT NULL,
    role TEXT DEFAULT 'colaborador',
    criado_em TEXT DEFAULT (datetime('now','localtime'))
  );
`;
code = code.replace("CREATE TABLE IF NOT EXISTS empresas", newSchema + "\n  CREATE TABLE IF NOT EXISTS empresas");

const migrations = `
try { db.prepare('ALTER TABLE execucoes ADD COLUMN comprovante TEXT').run(); } catch(e) {}
try { db.prepare('ALTER TABLE historico ADD COLUMN comprovante TEXT').run(); } catch(e) {}

// Seed Default Admin
if (db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n === 0) {
  const hash = bcrypt.hashSync('123456', 10);
  db.prepare("INSERT INTO usuarios (nome, email, senha_hash, role) VALUES (?, ?, ?, ?)").run('Administrador', 'admin@admin.com', hash, 'admin');
}
`;
code = code.replace("// Migrations\ntry { db.prepare('ALTER TABLE tarefas ADD COLUMN dia_vencimento INTEGER').run(); } catch(e) {}", "// Migrations\ntry { db.prepare('ALTER TABLE tarefas ADD COLUMN dia_vencimento INTEGER').run(); } catch(e) {}\n" + migrations);


// 3. AUTH ENDPOINTS
const authEndpoints = `
// ── AUTH ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { email, senha } = req.body;
  const user = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(senha, user.senha_hash)) return res.status(401).json({ erro: 'Credenciais inválidas' });
  const token = jwt.sign({ id: user.id, nome: user.nome, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, nome: user.nome, role: user.role } });
});

app.get('/api/auth/me', auth(), (req, res) => {
  res.json(req.user);
});
`;
code = code.replace("// ── EMPRESAS", authEndpoints + "\n// ── EMPRESAS");


// 4. PROTECTING ROUTES
const adminOnly = "auth(['admin'])";
const allAuth = "auth(['admin', 'colaborador'])";

const routesToProtect = {
  "/api/empresas": adminOnly,
  "/api/empresas/:id": adminOnly,
  "/api/empresas/import": adminOnly,
  "/api/tarefas": adminOnly,
  "/api/tarefas/:id": adminOnly,
  "/api/execucoes": allAuth,
  "/api/execucoes/:id": allAuth,
  "/api/execucoes/reset": adminOnly,
  "/api/mes/fechar": adminOnly,
  "/api/historico/meses": allAuth,
  "/api/historico/resumo": allAuth,
  "/api/historico": allAuth,
  "/api/historico/:id": allAuth,
  "/api/dashboard": allAuth,
  "/api/dashboard/matrix": allAuth,
  "/api/configuracoes": adminOnly,
  "/api/notificacoes": allAuth
};

for (const [route, middleware] of Object.entries(routesToProtect)) {
  code = code.replace(new RegExp(`app\\.get\\('${route}', \\(req,res\\) => {`, 'g'), `app.get('${route}', ${middleware}, (req,res) => {`);
  code = code.replace(new RegExp(`app\\.post\\('${route}', \\(req,res\\) => {`, 'g'), `app.post('${route}', ${middleware}, (req,res) => {`);
  code = code.replace(new RegExp(`app\\.put\\('${route}', \\(req,res\\) => {`, 'g'), `app.put('${route}', ${middleware}, (req,res) => {`);
  code = code.replace(new RegExp(`app\\.delete\\('${route}', \\(req,res\\) => {`, 'g'), `app.delete('${route}', ${middleware}, (req,res) => {`);
}

// 5. AUTO-RESPONSAVEL EM EXECUCOES
code = code.replace(
  "const {o_que_foi_feito,quando,observacoes,status,responsavel}=parsed.data;",
  "const {o_que_foi_feito,quando,observacoes,status}=parsed.data;\n  const responsavel = req.user.nome;"
);


// 6. UPLOAD DE COMPROVANTE
const uploadEndpoint = `
app.post('/api/execucoes/:id/comprovante', auth(['admin', 'colaborador']), upload.single('comprovante'), (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado' });
  db.prepare('UPDATE execucoes SET comprovante = ? WHERE id = ?').run(req.file.filename, req.params.id);
  res.json({ mensagem: 'Comprovante salvo', arquivo: req.file.filename });
});
`;
code = code.replace("// ── FECHAR MÊS", uploadEndpoint + "\n// ── FECHAR MÊS");

// Fix Historico archiver to copy 'comprovante'
code = code.replace(
  "const iH=db.prepare('INSERT INTO historico (empresa_id,tarefa_id,empresa_nome,tarefa_nome,categoria,mes_referencia,o_que_foi_feito,quando,observacoes,status,responsavel) VALUES(?,?,?,?,?,?,?,?,?,?,?)');",
  "const iH=db.prepare('INSERT INTO historico (empresa_id,tarefa_id,empresa_nome,tarefa_nome,categoria,mes_referencia,o_que_foi_feito,quando,observacoes,status,responsavel,comprovante) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');"
);
code = code.replace(
  "execs.forEach(e=>iH.run(e.empresa_id,e.tarefa_id,e.empresa_nome,e.tarefa_nome,e.categoria,mes_referencia,e.o_que_foi_feito,e.quando,e.observacoes,e.status,e.responsavel));",
  "execs.forEach(e=>iH.run(e.empresa_id,e.tarefa_id,e.empresa_nome,e.tarefa_nome,e.categoria,mes_referencia,e.o_que_foi_feito,e.quando,e.observacoes,e.status,e.responsavel,e.comprovante));"
);
code = code.replace(
  "UPDATE execucoes SET status='pendente',o_que_foi_feito=NULL,quando=NULL,observacoes=NULL,responsavel=NULL,atualizado_em=datetime('now','localtime')",
  "UPDATE execucoes SET status='pendente',o_que_foi_feito=NULL,quando=NULL,observacoes=NULL,responsavel=NULL,comprovante=NULL,atualizado_em=datetime('now','localtime')"
);


// 7. CRON JOB FECHAMENTO
const cronJob = `
// CRON: Rodar todo dia 1º do mês às 00:00
cron.schedule('0 0 1 * *', () => {
  console.log('🤖 CRON: Iniciando fechamento automático...');
  try {
    const data = new Date(); data.setMonth(data.getMonth() - 1);
    const mes_referencia = data.toISOString().slice(0, 7); // YYYY-MM
    const execs=db.prepare('SELECT e.*,em.nome AS empresa_nome,t.nome AS tarefa_nome,t.categoria FROM execucoes e JOIN empresas em ON em.id=e.empresa_id JOIN tarefas t ON t.id=e.tarefa_id').all();
    const iH=db.prepare('INSERT INTO historico (empresa_id,tarefa_id,empresa_nome,tarefa_nome,categoria,mes_referencia,o_que_foi_feito,quando,observacoes,status,responsavel,comprovante) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
    db.transaction(()=>{
      execs.forEach(e=>iH.run(e.empresa_id,e.tarefa_id,e.empresa_nome,e.tarefa_nome,e.categoria,mes_referencia,e.o_que_foi_feito,e.quando,e.observacoes,e.status,e.responsavel,e.comprovante));
      db.prepare("UPDATE execucoes SET status='pendente',o_que_foi_feito=NULL,quando=NULL,observacoes=NULL,responsavel=NULL,comprovante=NULL,atualizado_em=datetime('now','localtime')").run();
    })();
    console.log(\`✅ CRON: Mês \${mes_referencia} fechado com sucesso!\`);
  } catch (e) { console.error('Erro no CRON:', e); }
});
`;
code = code.replace("app.listen(PORT,()=>console.log(`🚀 http://localhost:${PORT}`));", cronJob + "\napp.listen(PORT,()=>console.log(`🚀 http://localhost:${PORT}`));");


// 8. SLA DASHBOARD
const slaEndpoint = `
app.get('/api/dashboard/sla', auth(['admin', 'colaborador']), (req, res) => {
  const concluidas = db.prepare(\`
    SELECT e.quando, t.dia_vencimento
    FROM execucoes e
    JOIN tarefas t ON t.id = e.tarefa_id
    WHERE e.status = 'concluida' AND e.quando IS NOT NULL AND t.dia_vencimento IS NOT NULL
  \`).all();

  let no_prazo = 0, atrasadas = 0;
  concluidas.forEach(c => {
    const dia_realizado = parseInt(c.quando.split('-')[2]);
    if (dia_realizado <= c.dia_vencimento) no_prazo++; else atrasadas++;
  });
  res.json({ no_prazo, atrasadas, total: concluidas.length });
});
`;
code = code.replace("// ── DASHBOARD", "// ── DASHBOARD\n" + slaEndpoint);

fs.writeFileSync('server.js', code);
