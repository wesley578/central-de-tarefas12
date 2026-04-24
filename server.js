require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const { z } = require('zod');


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

const app = express();
const PORT = process.env.PORT || 3000;

const dbPath = process.env.DB_PATH || path.join(__dirname, 'tarefas.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    senha_hash TEXT NOT NULL,
    role TEXT DEFAULT 'colaborador',
    criado_em TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS empresas (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    nome      TEXT    NOT NULL,
    cnpj      TEXT,
    regime    TEXT,
    ativo     INTEGER DEFAULT 1,
    criado_em TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS tarefas (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    nome      TEXT    NOT NULL,
    categoria TEXT,
    descricao TEXT,
    dia_vencimento INTEGER,
    criado_em TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS empresa_tarefas (
    empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    tarefa_id  INTEGER NOT NULL REFERENCES tarefas(id)  ON DELETE CASCADE,
    ativo      INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (empresa_id, tarefa_id)
  );
  CREATE TABLE IF NOT EXISTS execucoes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa_id      INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    tarefa_id       INTEGER NOT NULL REFERENCES tarefas(id)  ON DELETE CASCADE,
    o_que_foi_feito TEXT,
    quando          TEXT,
    observacoes     TEXT,
    status          TEXT DEFAULT 'pendente',
    responsavel     TEXT,
    criado_em       TEXT DEFAULT (datetime('now','localtime')),
    atualizado_em   TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(empresa_id, tarefa_id)
  );
  CREATE TABLE IF NOT EXISTS historico (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa_id      INTEGER,
    tarefa_id       INTEGER,
    empresa_nome    TEXT NOT NULL,
    tarefa_nome     TEXT NOT NULL,
    categoria       TEXT,
    mes_referencia  TEXT NOT NULL,
    o_que_foi_feito TEXT,
    quando          TEXT,
    observacoes     TEXT,
    status          TEXT,
    responsavel     TEXT,
    arquivado_em    TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_exec_empresa ON execucoes(empresa_id);
  CREATE INDEX IF NOT EXISTS idx_exec_status  ON execucoes(status);
  CREATE INDEX IF NOT EXISTS idx_hist_mes     ON historico(mes_referencia);
  CREATE INDEX IF NOT EXISTS idx_et_empresa   ON empresa_tarefas(empresa_id);

  CREATE TABLE IF NOT EXISTS configuracoes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nome_escritorio TEXT DEFAULT 'Escritório de Contabilidade'
  );
`);

// Migrations
try { db.prepare('ALTER TABLE tarefas ADD COLUMN dia_vencimento INTEGER').run(); } catch(e) {}

try { db.prepare('ALTER TABLE execucoes ADD COLUMN comprovante TEXT').run(); } catch(e) {}
try { db.prepare('ALTER TABLE historico ADD COLUMN comprovante TEXT').run(); } catch(e) {}

// Seed Default Admin
if (db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n === 0) {
  const hash = bcrypt.hashSync('123456', 10);
  db.prepare("INSERT INTO usuarios (nome, email, senha_hash, role) VALUES (?, ?, ?, ?)").run('Administrador', 'admin@admin.com', hash, 'admin');
}


// Migration: populate empresa_tarefas if empty but data exists
{
  const etCount = db.prepare('SELECT COUNT(*) AS n FROM empresa_tarefas').get().n;
  if (etCount === 0) {
    const empresas = db.prepare('SELECT id FROM empresas').all();
    const tarefas  = db.prepare('SELECT id FROM tarefas').all();
    if (empresas.length && tarefas.length) {
      const ins = db.prepare('INSERT OR IGNORE INTO empresa_tarefas (empresa_id,tarefa_id,ativo) VALUES(?,?,1)');
      db.transaction(() => { empresas.forEach(e => tarefas.forEach(t => ins.run(e.id,t.id))); })();
    }
  }
}

// Seed Config
if (db.prepare('SELECT COUNT(*) AS n FROM configuracoes').get().n === 0) {
  db.prepare("INSERT INTO configuracoes (nome_escritorio) VALUES ('Escritório de Contabilidade')").run();
}

// Seed
if (db.prepare('SELECT COUNT(*) AS n FROM tarefas').get().n === 0) {
  const iE = db.prepare('INSERT INTO empresas (nome,cnpj,regime) VALUES(?,?,?)');
  const iT = db.prepare('INSERT INTO tarefas (nome,categoria,descricao) VALUES(?,?,?)');
  const iET = db.prepare('INSERT OR IGNORE INTO empresa_tarefas (empresa_id,tarefa_id,ativo) VALUES(?,?,?)');
  const iX  = db.prepare("INSERT OR IGNORE INTO execucoes (empresa_id,tarefa_id,status) VALUES(?,?,'pendente')");

  db.transaction(() => {
    iE.run('Padaria Estrela LTDA','12.345.678/0001-90','SIMPLES');
    iE.run('TechFix Soluções ME','23.456.789/0001-01','SIMPLES');
    iE.run('Transportes Rota Sul','34.567.890/0001-12','PRESUMIDO');
    iE.run('Maria das Flores MEI','456.789.012-34','MEI');
    iE.run('Construtora Alvorada','56.789.012/0001-56','REAL');
    iT.run('Escrituração Fiscal Mensal','Fiscal','Lançamento de notas de entrada e saída');
    iT.run('Apuração de Impostos (DAS)','Fiscal','Cálculo e emissão do DAS');
    iT.run('Conferência de Faturamento','Fiscal','Validação do faturamento');
    iT.run('Lançamentos Contábeis','Contábil','Lançamentos mensais no sistema');
    iT.run('Conciliação Bancária','Contábil','Conferência dos extratos bancários');
    iT.run('Folha de Pagamento','Dep. Pessoal','Processamento e envio da folha');
    iT.run('Recolhimento do FGTS','Dep. Pessoal','Geração e envio da guia FGTS');
    iT.run('Envio de Eventos e-Social','Dep. Pessoal','Transmissão dos eventos mensais');
    iT.run('PGDAS-D (Simples Nacional)','Obrigações Acessórias','Entrega da declaração mensal');
    iT.run('Verificação de Certidões','Obrigações Acessórias','CND, FGTS, Trabalhista');
    iT.run('Cobrança de Honorários','Administrativo','Emissão e envio de cobranças');
    iT.run('Envio de Fechamentos ao Cliente','Administrativo','Envio via Onvio ou WhatsApp');
  })();

  const allE = db.prepare('SELECT id FROM empresas').all();
  const allT = db.prepare('SELECT id FROM tarefas').all();

  // MEI (id=4) não tem Dep. Pessoal (ids 6,7,8); REAL (id=5) não tem PGDAS (id=9)
  const disabled = { 4:[6,7,8], 5:[9] };
  db.transaction(() => {
    allE.forEach(e => {
      const dis = new Set(disabled[e.id] || []);
      allT.forEach(t => {
        const ativo = dis.has(t.id) ? 0 : 1;
        iET.run(e.id, t.id, ativo);
        if (ativo) iX.run(e.id, t.id);
      });
    });
  })();
  console.log('✅ Seed completo.');
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pct = (d,t) => t > 0 ? Math.round(d/t*100) : 0;
const VALID_STATUS = ['pendente','em_andamento','concluida','bloqueada'];

const EmpresaSchema = z.object({ nome: z.string().min(1, 'Nome obrigatório'), cnpj: z.string().optional().nullable(), regime: z.string().optional().nullable(), tarefas_ids: z.array(z.number()).optional() });
const EmpresaUpdateSchema = EmpresaSchema.extend({ ativo: z.number().optional() });
const TarefaSchema = z.object({ nome: z.string().min(1, 'Nome obrigatório'), categoria: z.string().optional().nullable(), descricao: z.string().optional().nullable(), dia_vencimento: z.number().min(1).max(31).optional().nullable() });
const ExecucaoUpdateSchema = z.object({ o_que_foi_feito: z.string().nullable().optional(), quando: z.string().nullable().optional(), observacoes: z.string().nullable().optional(), status: z.enum(['pendente','em_andamento','concluida','bloqueada']).optional(), responsavel: z.string().nullable().optional() });



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

// ── EMPRESAS ──────────────────────────────────────────────────────────────────
app.get('/api/empresas', auth(['admin']), (req,res) => {
  const {ativo} = req.query;
  let q = 'SELECT * FROM empresas';
  const p = [];
  if (ativo !== undefined) { q += ' WHERE ativo=?'; p.push(Number(ativo)); }
  res.json(db.prepare(q+' ORDER BY nome').all(...p));
});

app.get('/api/empresas/:id', auth(['admin']), (req,res) => {
  const row = db.prepare('SELECT * FROM empresas WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({erro:'Empresa não encontrada'});
  const tarefas = db.prepare(`
    SELECT t.id, t.nome, t.categoria, t.descricao,
           COALESCE(et.ativo,0) AS habilitada
    FROM tarefas t
    LEFT JOIN empresa_tarefas et ON et.tarefa_id=t.id AND et.empresa_id=?
    ORDER BY t.categoria, t.nome
  `).all(req.params.id);
  res.json({...row, tarefas});
});

app.post('/api/empresas', auth(['admin']), (req,res) => {
  const parsed = EmpresaSchema.safeParse(req.body); if(!parsed.success) return res.status(400).json({erro:parsed.error.errors[0].message});
  const {nome, cnpj, regime, tarefas_ids} = parsed.data;
  const allT = db.prepare('SELECT id FROM tarefas').all();
  const enabled = tarefas_ids ? new Set(tarefas_ids.map(Number)) : new Set(allT.map(t=>t.id));
  const eid = db.prepare('INSERT INTO empresas (nome,cnpj,regime) VALUES(?,?,?)').run(nome, cnpj||null, regime||null).lastInsertRowid;
  const iET = db.prepare('INSERT OR REPLACE INTO empresa_tarefas (empresa_id,tarefa_id,ativo) VALUES(?,?,?)');
  const iX  = db.prepare("INSERT OR IGNORE INTO execucoes (empresa_id,tarefa_id,status) VALUES(?,?,'pendente')");
  db.transaction(() => { allT.forEach(t => { const a=enabled.has(t.id)?1:0; iET.run(eid,t.id,a); if(a) iX.run(eid,t.id); }); })();
  res.status(201).json(db.prepare('SELECT * FROM empresas WHERE id=?').get(eid));
});

app.post('/api/empresas/import', auth(['admin']), (req,res) => {
  const empresas = req.body;
  if (!Array.isArray(empresas)) return res.status(400).json({erro:'Formato inválido. Esperado um array.'});
  
  const allT = db.prepare('SELECT id FROM tarefas').all();
  const insertEmpresa = db.prepare('INSERT INTO empresas (nome,cnpj,regime) VALUES(?,?,?)');
  const iET = db.prepare('INSERT OR REPLACE INTO empresa_tarefas (empresa_id,tarefa_id,ativo) VALUES(?,?,?)');
  const iX  = db.prepare("INSERT OR IGNORE INTO execucoes (empresa_id,tarefa_id,status) VALUES(?,?,'pendente')");
  
  let count = 0;
  db.transaction(() => {
    for (const emp of empresas) {
      if (!emp.nome) continue;
      const eid = insertEmpresa.run(emp.nome, emp.cnpj||null, emp.regime||null).lastInsertRowid;
      allT.forEach(t => { 
        iET.run(eid, t.id, 1); 
        iX.run(eid, t.id); 
      });
      count++;
    }
  })();
  
  res.status(201).json({mensagem:`${count} empresas importadas com sucesso.`});
});

app.put('/api/empresas/:id', auth(['admin']), (req,res) => {
  const parsed = EmpresaUpdateSchema.safeParse(req.body); if(!parsed.success) return res.status(400).json({erro:parsed.error.errors[0].message});
  const {nome, cnpj, regime, ativo, tarefas_ids} = parsed.data;
  if (!db.prepare('SELECT id FROM empresas WHERE id=?').get(req.params.id)) return res.status(404).json({erro:'Empresa não encontrada'});
  db.prepare('UPDATE empresas SET nome=COALESCE(?,nome),cnpj=COALESCE(?,cnpj),regime=COALESCE(?,regime),ativo=COALESCE(?,ativo) WHERE id=?').run(nome,cnpj,regime,ativo,req.params.id);
  if (tarefas_ids !== undefined) {
    const allT = db.prepare('SELECT id FROM tarefas').all();
    const enabled = new Set(tarefas_ids.map(Number));
    const iET = db.prepare('INSERT OR REPLACE INTO empresa_tarefas (empresa_id,tarefa_id,ativo) VALUES(?,?,?)');
    const iX  = db.prepare("INSERT OR IGNORE INTO execucoes (empresa_id,tarefa_id,status) VALUES(?,?,'pendente')");
    const dX  = db.prepare('DELETE FROM execucoes WHERE empresa_id=? AND tarefa_id=?');
    db.transaction(() => { allT.forEach(t => { const a=enabled.has(t.id)?1:0; iET.run(req.params.id,t.id,a); if(a) iX.run(req.params.id,t.id); else dX.run(req.params.id,t.id); }); })();
  }
  res.json(db.prepare('SELECT * FROM empresas WHERE id=?').get(req.params.id));
});

app.delete('/api/empresas/:id', auth(['admin']), (req,res) => {
  if (!db.prepare('DELETE FROM empresas WHERE id=?').run(req.params.id).changes) return res.status(404).json({erro:'Não encontrada'});
  res.json({mensagem:'Empresa removida'});
});

// ── TAREFAS ───────────────────────────────────────────────────────────────────
app.get('/api/tarefas', auth(['admin']), (req,res) => {
  const {categoria} = req.query;
  let q='SELECT * FROM tarefas'; const p=[];
  if (categoria){q+=' WHERE categoria=?';p.push(categoria);}
  res.json(db.prepare(q+' ORDER BY categoria,nome').all(...p));
});
app.get('/api/tarefas/:id', auth(['admin']), (req,res) => {
  const r=db.prepare('SELECT * FROM tarefas WHERE id=?').get(req.params.id);
  if(!r) return res.status(404).json({erro:'Não encontrada'});
  res.json(r);
});
app.post('/api/tarefas', auth(['admin']), (req,res) => {
  const parsed = TarefaSchema.safeParse(req.body); if(!parsed.success) return res.status(400).json({erro:parsed.error.errors[0].message});
  const {nome,categoria,descricao,dia_vencimento}=parsed.data;
  const tid=db.prepare('INSERT INTO tarefas (nome,categoria,descricao,dia_vencimento) VALUES(?,?,?,?)').run(nome,categoria||null,descricao||null,dia_vencimento||null).lastInsertRowid;
  const empresas=db.prepare('SELECT id FROM empresas WHERE ativo=1').all();
  const iET=db.prepare('INSERT OR IGNORE INTO empresa_tarefas (empresa_id,tarefa_id,ativo) VALUES(?,?,1)');
  const iX=db.prepare("INSERT OR IGNORE INTO execucoes (empresa_id,tarefa_id,status) VALUES(?,?,'pendente')");
  db.transaction(()=>{empresas.forEach(e=>{iET.run(e.id,tid);iX.run(e.id,tid);});})();
  res.status(201).json(db.prepare('SELECT * FROM tarefas WHERE id=?').get(tid));
});
app.put('/api/tarefas/:id', auth(['admin']), (req,res) => {
  if(!db.prepare('SELECT id FROM tarefas WHERE id=?').get(req.params.id)) return res.status(404).json({erro:'Não encontrada'});
  const parsed = TarefaSchema.safeParse(req.body); if(!parsed.success) return res.status(400).json({erro:parsed.error.errors[0].message});
  const {nome,categoria,descricao,dia_vencimento}=parsed.data;
  db.prepare('UPDATE tarefas SET nome=COALESCE(?,nome),categoria=COALESCE(?,categoria),descricao=COALESCE(?,descricao),dia_vencimento=COALESCE(?,dia_vencimento) WHERE id=?').run(nome,categoria,descricao,dia_vencimento,req.params.id);
  res.json(db.prepare('SELECT * FROM tarefas WHERE id=?').get(req.params.id));
});
app.delete('/api/tarefas/:id', auth(['admin']), (req,res) => {
  if(!db.prepare('DELETE FROM tarefas WHERE id=?').run(req.params.id).changes) return res.status(404).json({erro:'Não encontrada'});
  res.json({mensagem:'Tarefa removida'});
});

// ── EXECUÇÕES ─────────────────────────────────────────────────────────────────
app.get('/api/execucoes', auth(['admin', 'colaborador']), (req,res) => {
  const {empresa_id,tarefa_id,status,categoria,page=1,limit=50}=req.query;
  const pPage=Math.max(1,+page), pLimit=Math.max(1,+limit), offset=(pPage-1)*pLimit;
  let q=`SELECT e.*, em.nome AS empresa_nome, em.regime, t.nome AS tarefa_nome, t.categoria FROM execucoes e JOIN empresas em ON em.id=e.empresa_id JOIN tarefas t ON t.id=e.tarefa_id WHERE 1=1`;
  let qC=`SELECT COUNT(*) AS total FROM execucoes e JOIN empresas em ON em.id=e.empresa_id JOIN tarefas t ON t.id=e.tarefa_id WHERE 1=1`;
  const p=[];
  if(empresa_id){q+=' AND e.empresa_id=?';qC+=' AND e.empresa_id=?';p.push(empresa_id);}
  if(tarefa_id){q+=' AND e.tarefa_id=?';qC+=' AND e.tarefa_id=?';p.push(tarefa_id);}
  if(status){q+=' AND e.status=?';qC+=' AND e.status=?';p.push(status);}
  if(categoria){q+=' AND t.categoria=?';qC+=' AND t.categoria=?';p.push(categoria);}
  const total = db.prepare(qC).get(...p).total;
  const data = db.prepare(q+' ORDER BY em.nome,t.categoria,t.nome LIMIT ? OFFSET ?').all(...p, pLimit, offset);
  res.json({data, total, page:pPage, limit:pLimit});
});
app.get('/api/execucoes/:id', auth(['admin', 'colaborador']), (req,res) => {
  const r=db.prepare('SELECT e.*,em.nome AS empresa_nome,t.nome AS tarefa_nome,t.categoria FROM execucoes e JOIN empresas em ON em.id=e.empresa_id JOIN tarefas t ON t.id=e.tarefa_id WHERE e.id=?').get(req.params.id);
  if(!r) return res.status(404).json({erro:'Não encontrada'});
  res.json(r);
});
app.put('/api/execucoes/:id', auth(['admin', 'colaborador']), (req,res) => {
  if(!db.prepare('SELECT id FROM execucoes WHERE id=?').get(req.params.id)) return res.status(404).json({erro:'Não encontrada'});
  const parsed = ExecucaoUpdateSchema.safeParse(req.body); if(!parsed.success) return res.status(400).json({erro:parsed.error.errors[0].message});
  const {o_que_foi_feito,quando,observacoes,status}=parsed.data;
  const responsavel = req.user.nome;
  db.prepare(`UPDATE execucoes SET o_que_foi_feito=COALESCE(?,o_que_foi_feito),quando=COALESCE(?,quando),observacoes=COALESCE(?,observacoes),status=COALESCE(?,status),responsavel=COALESCE(?,responsavel),atualizado_em=datetime('now','localtime') WHERE id=?`).run(o_que_foi_feito,quando,observacoes,status,responsavel,req.params.id);
  res.json(db.prepare('SELECT e.*,em.nome AS empresa_nome,t.nome AS tarefa_nome,t.categoria FROM execucoes e JOIN empresas em ON em.id=e.empresa_id JOIN tarefas t ON t.id=e.tarefa_id WHERE e.id=?').get(req.params.id));
});
app.post('/api/execucoes/reset', auth(['admin']), (req,res) => {
  const {empresa_id}=req.body;
  if(!empresa_id) return res.status(400).json({erro:'empresa_id obrigatório'});
  db.prepare("UPDATE execucoes SET status='pendente',o_que_foi_feito=NULL,quando=NULL,observacoes=NULL,responsavel=NULL,comprovante=NULL,atualizado_em=datetime('now','localtime') WHERE empresa_id=?").run(empresa_id);
  res.json({mensagem:'Execuções reiniciadas'});
});


app.post('/api/execucoes/:id/comprovante', auth(['admin', 'colaborador']), upload.single('comprovante'), (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado' });
  db.prepare('UPDATE execucoes SET comprovante = ? WHERE id = ?').run(req.file.filename, req.params.id);
  res.json({ mensagem: 'Comprovante salvo', arquivo: req.file.filename });
});

// ── FECHAR MÊS ────────────────────────────────────────────────────────────────
app.post('/api/mes/fechar', auth(['admin']), (req,res) => {
  const {mes_referencia}=req.body;
  if(!mes_referencia||!/^\d{4}-\d{2}$/.test(mes_referencia)) return res.status(400).json({erro:'mes_referencia obrigatório no formato YYYY-MM'});
  const execs=db.prepare('SELECT e.*,em.nome AS empresa_nome,t.nome AS tarefa_nome,t.categoria FROM execucoes e JOIN empresas em ON em.id=e.empresa_id JOIN tarefas t ON t.id=e.tarefa_id').all();
  const iH=db.prepare('INSERT INTO historico (empresa_id,tarefa_id,empresa_nome,tarefa_nome,categoria,mes_referencia,o_que_foi_feito,quando,observacoes,status,responsavel,comprovante) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  db.transaction(()=>{
    execs.forEach(e=>iH.run(e.empresa_id,e.tarefa_id,e.empresa_nome,e.tarefa_nome,e.categoria,mes_referencia,e.o_que_foi_feito,e.quando,e.observacoes,e.status,e.responsavel,e.comprovante));
    db.prepare("UPDATE execucoes SET status='pendente',o_que_foi_feito=NULL,quando=NULL,observacoes=NULL,responsavel=NULL,atualizado_em=datetime('now','localtime')").run();
  })();
  res.json({mensagem:`Mês ${mes_referencia} arquivado.`,total:execs.length});
});

// ── HISTÓRICO ─────────────────────────────────────────────────────────────────
app.get('/api/historico/meses', auth(['admin', 'colaborador']), (req,res) => {
  res.json(db.prepare('SELECT DISTINCT mes_referencia FROM historico ORDER BY mes_referencia DESC').all().map(r=>r.mes_referencia));
});
app.get('/api/historico/resumo', auth(['admin', 'colaborador']), (req,res) => {
  res.json(db.prepare(`SELECT mes_referencia, COUNT(*) AS total, SUM(CASE WHEN status='concluida' THEN 1 ELSE 0 END) AS concluidas, SUM(CASE WHEN status='pendente' THEN 1 ELSE 0 END) AS pendentes, SUM(CASE WHEN status='bloqueada' THEN 1 ELSE 0 END) AS bloqueadas, COUNT(DISTINCT empresa_id) AS empresas, ROUND(100.0*SUM(CASE WHEN status='concluida' THEN 1 ELSE 0 END)/COUNT(*),1) AS percentual FROM historico GROUP BY mes_referencia ORDER BY mes_referencia DESC`).all());
});
app.get('/api/historico', auth(['admin', 'colaborador']), (req,res) => {
  const {mes_referencia,empresa_id,status,categoria,page=1,limit=50}=req.query;
  const pPage=Math.max(1,+page), pLimit=Math.max(1,+limit), offset=(pPage-1)*pLimit;
  let q='SELECT * FROM historico WHERE 1=1'; 
  let qC='SELECT COUNT(*) AS total FROM historico WHERE 1=1'; 
  const p=[];
  if(mes_referencia){q+=' AND mes_referencia=?';qC+=' AND mes_referencia=?';p.push(mes_referencia);}
  if(empresa_id){q+=' AND empresa_id=?';qC+=' AND empresa_id=?';p.push(empresa_id);}
  if(status){q+=' AND status=?';qC+=' AND status=?';p.push(status);}
  if(categoria){q+=' AND categoria=?';qC+=' AND categoria=?';p.push(categoria);}
  const total = db.prepare(qC).get(...p).total;
  const data = db.prepare(q+' ORDER BY empresa_nome,categoria,tarefa_nome LIMIT ? OFFSET ?').all(...p, pLimit, offset);
  res.json({data, total, page:pPage, limit:pLimit});
});
app.put('/api/historico/:id', auth(['admin', 'colaborador']), (req,res) => {
  if(!db.prepare('SELECT id FROM historico WHERE id=?').get(req.params.id)) return res.status(404).json({erro:'Não encontrado'});
  const parsed = ExecucaoUpdateSchema.safeParse(req.body); if(!parsed.success) return res.status(400).json({erro:parsed.error.errors[0].message});
  const {o_que_foi_feito,quando,observacoes,status,responsavel}=parsed.data;
  db.prepare('UPDATE historico SET o_que_foi_feito=COALESCE(?,o_que_foi_feito),quando=COALESCE(?,quando),observacoes=COALESCE(?,observacoes),status=COALESCE(?,status),responsavel=COALESCE(?,responsavel) WHERE id=?').run(o_que_foi_feito,quando,observacoes,status,responsavel,req.params.id);
  res.json(db.prepare('SELECT * FROM historico WHERE id=?').get(req.params.id));
});


// ── NOTIFICAÇÕES ──────────────────────────────────────────────────────────────
app.get('/api/notificacoes', (req, res) => {
  const today = new Date().getDate();
  const alerts = db.prepare(`
    SELECT e.id, em.nome AS empresa_nome, t.nome AS tarefa_nome, t.dia_vencimento
    FROM execucoes e
    JOIN empresas em ON em.id = e.empresa_id
    JOIN tarefas t ON t.id = e.tarefa_id
    WHERE e.status != 'concluida' AND t.dia_vencimento IS NOT NULL AND t.dia_vencimento <= ?
    ORDER BY t.dia_vencimento ASC
  `).all(today);
  res.json(alerts);
});

// ── DASHBOARD

app.get('/api/dashboard/sla', auth(['admin', 'colaborador']), (req, res) => {
  const concluidas = db.prepare(`
    SELECT e.quando, t.dia_vencimento
    FROM execucoes e
    JOIN tarefas t ON t.id = e.tarefa_id
    WHERE e.status = 'concluida' AND e.quando IS NOT NULL AND t.dia_vencimento IS NOT NULL
  `).all();

  let no_prazo = 0, atrasadas = 0;
  concluidas.forEach(c => {
    const dia_realizado = parseInt(c.quando.split('-')[2]);
    if (dia_realizado <= c.dia_vencimento) no_prazo++; else atrasadas++;
  });
  res.json({ no_prazo, atrasadas, total: concluidas.length });
});
// ── DASHBOARD ─────────────────────────────────────────────────────────────────
app.get('/api/dashboard', auth(['admin', 'colaborador']), (req,res) => {
  const totalEmpresas   = db.prepare("SELECT COUNT(*) AS n FROM empresas WHERE ativo=1").get().n;
  const totalTarefas    = db.prepare("SELECT COUNT(*) AS n FROM tarefas").get().n;
  const totalExecucoes  = db.prepare("SELECT COUNT(*) AS n FROM execucoes").get().n;
  const totalConcluidas = db.prepare("SELECT COUNT(*) AS n FROM execucoes WHERE status='concluida'").get().n;

  const porTarefa = db.prepare(`
    SELECT t.id, t.nome, t.categoria,
      COUNT(e.id) AS total,
      SUM(CASE WHEN e.status='concluida'    THEN 1 ELSE 0 END) AS concluidas,
      SUM(CASE WHEN e.status='em_andamento' THEN 1 ELSE 0 END) AS em_andamento,
      SUM(CASE WHEN e.status='pendente'     THEN 1 ELSE 0 END) AS pendentes,
      SUM(CASE WHEN e.status='bloqueada'    THEN 1 ELSE 0 END) AS bloqueadas,
      ROUND(100.0*SUM(CASE WHEN e.status='concluida' THEN 1 ELSE 0 END)/MAX(COUNT(e.id),1),1) AS percentual
    FROM tarefas t
    JOIN empresa_tarefas et ON et.tarefa_id=t.id AND et.ativo=1
    LEFT JOIN execucoes e ON e.tarefa_id=t.id AND e.empresa_id=et.empresa_id
    LEFT JOIN empresas em ON em.id=et.empresa_id AND em.ativo=1
    WHERE em.id IS NOT NULL
    GROUP BY t.id ORDER BY t.categoria, percentual DESC
  `).all();

  const porEmpresa = db.prepare(`
    SELECT em.id, em.nome, em.regime,
      COUNT(e.id) AS total,
      SUM(CASE WHEN e.status='concluida'    THEN 1 ELSE 0 END) AS concluidas,
      SUM(CASE WHEN e.status='em_andamento' THEN 1 ELSE 0 END) AS em_andamento,
      SUM(CASE WHEN e.status='pendente'     THEN 1 ELSE 0 END) AS pendentes,
      SUM(CASE WHEN e.status='bloqueada'    THEN 1 ELSE 0 END) AS bloqueadas,
      ROUND(100.0*SUM(CASE WHEN e.status='concluida' THEN 1 ELSE 0 END)/MAX(COUNT(e.id),1),1) AS percentual
    FROM empresas em
    JOIN empresa_tarefas et ON et.empresa_id=em.id AND et.ativo=1
    LEFT JOIN execucoes e ON e.empresa_id=em.id AND e.tarefa_id=et.tarefa_id
    WHERE em.ativo=1 GROUP BY em.id ORDER BY percentual DESC
  `).all();

  const porCategoria = db.prepare(`
    SELECT t.categoria,
      COUNT(e.id) AS total,
      SUM(CASE WHEN e.status='concluida' THEN 1 ELSE 0 END) AS concluidas,
      ROUND(100.0*SUM(CASE WHEN e.status='concluida' THEN 1 ELSE 0 END)/MAX(COUNT(e.id),1),1) AS percentual
    FROM tarefas t
    JOIN empresa_tarefas et ON et.tarefa_id=t.id AND et.ativo=1
    LEFT JOIN execucoes e ON e.tarefa_id=t.id AND e.empresa_id=et.empresa_id
    LEFT JOIN empresas em ON em.id=et.empresa_id AND em.ativo=1
    WHERE em.id IS NOT NULL GROUP BY t.categoria ORDER BY percentual DESC
  `).all();

  const recentes = db.prepare(`
    SELECT e.id,e.status,e.o_que_foi_feito,e.quando,e.responsavel,e.atualizado_em,
           em.nome AS empresa_nome,t.nome AS tarefa_nome,t.categoria
    FROM execucoes e JOIN empresas em ON em.id=e.empresa_id JOIN tarefas t ON t.id=e.tarefa_id
    WHERE e.status!='pendente' ORDER BY e.atualizado_em DESC LIMIT 15
  `).all();

  res.json({resumo:{totalEmpresas,totalTarefas,totalExecucoes,totalConcluidas,percentualGeral:pct(totalConcluidas,totalExecucoes)},porTarefa,porEmpresa,porCategoria,recentes});
});

app.get('/api/dashboard/matrix', auth(['admin', 'colaborador']), (req,res) => {
  const empresas  = db.prepare("SELECT id,nome,regime FROM empresas WHERE ativo=1 ORDER BY nome").all();
  const tarefas   = db.prepare("SELECT id,nome,categoria FROM tarefas ORDER BY categoria,nome").all();
  const execucoes = db.prepare("SELECT empresa_id,tarefa_id,status FROM execucoes").all();
  const hab       = db.prepare("SELECT empresa_id,tarefa_id FROM empresa_tarefas WHERE ativo=1").all();
  const statusMap={}, habSet=new Set();
  execucoes.forEach(e=>statusMap[`${e.empresa_id}_${e.tarefa_id}`]=e.status);
  hab.forEach(h=>habSet.add(`${h.empresa_id}_${h.tarefa_id}`));
  const matrix={};
  empresas.forEach(e=>tarefas.forEach(t=>{const k=`${e.id}_${t.id}`; matrix[k]=habSet.has(k)?(statusMap[k]||'pendente'):'na';}));
  res.json({empresas,tarefas,matrix});
});

// ── CONFIGURAÇÕES ─────────────────────────────────────────────────────────────
app.get('/api/configuracoes', auth(['admin']), (req,res) => {
  res.json(db.prepare('SELECT * FROM configuracoes LIMIT 1').get() || { nome_escritorio: 'Escritório de Contabilidade' });
});

app.put('/api/configuracoes', auth(['admin']), (req,res) => {
  const {nome_escritorio} = req.body;
  if (!nome_escritorio) return res.status(400).json({erro:'Nome obrigatório'});
  db.prepare('UPDATE configuracoes SET nome_escritorio=?').run(nome_escritorio);
  res.json({mensagem:'Configurações atualizadas', nome_escritorio});
});

app.get('*',(_, res)=>res.sendFile(path.join(__dirname,'public','index.html')));

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
    console.log(`✅ CRON: Mês ${mes_referencia} fechado com sucesso!`);
  } catch (e) { console.error('Erro no CRON:', e); }
});

app.listen(PORT,()=>console.log(`🚀 http://localhost:${PORT}`));
