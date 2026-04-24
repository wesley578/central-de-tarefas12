#!/bin/bash
mkdir -p src/database src/controllers src/routes

# 1. Database
cat << 'DBEOF' > src/database/index.js
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../../tarefas.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
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

if (db.prepare('SELECT COUNT(*) AS n FROM configuracoes').get().n === 0) {
  db.prepare("INSERT INTO configuracoes (nome_escritorio) VALUES ('Escritório de Contabilidade')").run();
}

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
}

module.exports = db;
DBEOF

# 2. Controllers
cat << 'CTEOF' > src/controllers/EmpresasController.js
const db = require('../database');

module.exports = {
  listar(req, res) {
    const {ativo} = req.query;
    let q = 'SELECT * FROM empresas';
    const p = [];
    if (ativo !== undefined) { q += ' WHERE ativo=?'; p.push(Number(ativo)); }
    res.json(db.prepare(q+' ORDER BY nome').all(...p));
  },
  buscar(req, res) {
    const row = db.prepare('SELECT * FROM empresas WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({erro:'Empresa não encontrada'});
    const tarefas = db.prepare(`
      SELECT t.id, t.nome, t.categoria, t.descricao, COALESCE(et.ativo,0) AS habilitada
      FROM tarefas t LEFT JOIN empresa_tarefas et ON et.tarefa_id=t.id AND et.empresa_id=?
      ORDER BY t.categoria, t.nome
    `).all(req.params.id);
    res.json({...row, tarefas});
  },
  criar(req, res) {
    const {nome, cnpj, regime, tarefas_ids} = req.body;
    if (!nome) return res.status(400).json({erro:'Nome obrigatório'});
    const allT = db.prepare('SELECT id FROM tarefas').all();
    const enabled = tarefas_ids ? new Set(tarefas_ids.map(Number)) : new Set(allT.map(t=>t.id));
    const eid = db.prepare('INSERT INTO empresas (nome,cnpj,regime) VALUES(?,?,?)').run(nome, cnpj||null, regime||null).lastInsertRowid;
    const iET = db.prepare('INSERT OR REPLACE INTO empresa_tarefas (empresa_id,tarefa_id,ativo) VALUES(?,?,?)');
    const iX  = db.prepare("INSERT OR IGNORE INTO execucoes (empresa_id,tarefa_id,status) VALUES(?,?,'pendente')");
    db.transaction(() => { allT.forEach(t => { const a=enabled.has(t.id)?1:0; iET.run(eid,t.id,a); if(a) iX.run(eid,t.id); }); })();
    res.status(201).json(db.prepare('SELECT * FROM empresas WHERE id=?').get(eid));
  },
  importar(req, res) {
    const empresas = req.body;
    if (!Array.isArray(empresas)) return res.status(400).json({erro:'Formato inválido.'});
    const allT = db.prepare('SELECT id FROM tarefas').all();
    const insertEmpresa = db.prepare('INSERT INTO empresas (nome,cnpj,regime) VALUES(?,?,?)');
    const iET = db.prepare('INSERT OR REPLACE INTO empresa_tarefas (empresa_id,tarefa_id,ativo) VALUES(?,?,?)');
    const iX  = db.prepare("INSERT OR IGNORE INTO execucoes (empresa_id,tarefa_id,status) VALUES(?,?,'pendente')");
    let count = 0;
    db.transaction(() => {
      for (const emp of empresas) {
        if (!emp.nome) continue;
        const eid = insertEmpresa.run(emp.nome, emp.cnpj||null, emp.regime||null).lastInsertRowid;
        allT.forEach(t => { iET.run(eid, t.id, 1); iX.run(eid, t.id); });
        count++;
      }
    })();
    res.status(201).json({mensagem:`${count} empresas importadas com sucesso.`});
  },
  atualizar(req, res) {
    const {nome, cnpj, regime, ativo, tarefas_ids} = req.body;
    if (!db.prepare('SELECT id FROM empresas WHERE id=?').get(req.params.id)) return res.status(404).json({erro:'Não encontrada'});
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
  },
  remover(req, res) {
    if (!db.prepare('DELETE FROM empresas WHERE id=?').run(req.params.id).changes) return res.status(404).json({erro:'Não encontrada'});
    res.json({mensagem:'Empresa removida'});
  }
};
CTEOF

cat << 'CTEOF' > src/controllers/TarefasController.js
const db = require('../database');
module.exports = {
  listar(req, res) {
    const {categoria} = req.query;
    let q='SELECT * FROM tarefas'; const p=[];
    if (categoria){q+=' WHERE categoria=?';p.push(categoria);}
    res.json(db.prepare(q+' ORDER BY categoria,nome').all(...p));
  },
  buscar(req, res) {
    const r=db.prepare('SELECT * FROM tarefas WHERE id=?').get(req.params.id);
    if(!r) return res.status(404).json({erro:'Não encontrada'});
    res.json(r);
  },
  criar(req, res) {
    const {nome,categoria,descricao}=req.body;
    if(!nome) return res.status(400).json({erro:'Nome obrigatório'});
    const tid=db.prepare('INSERT INTO tarefas (nome,categoria,descricao) VALUES(?,?,?)').run(nome,categoria||null,descricao||null).lastInsertRowid;
    const empresas=db.prepare('SELECT id FROM empresas WHERE ativo=1').all();
    const iET=db.prepare('INSERT OR IGNORE INTO empresa_tarefas (empresa_id,tarefa_id,ativo) VALUES(?,?,1)');
    const iX=db.prepare("INSERT OR IGNORE INTO execucoes (empresa_id,tarefa_id,status) VALUES(?,?,'pendente')");
    db.transaction(()=>{empresas.forEach(e=>{iET.run(e.id,tid);iX.run(e.id,tid);});})();
    res.status(201).json(db.prepare('SELECT * FROM tarefas WHERE id=?').get(tid));
  },
  atualizar(req, res) {
    if(!db.prepare('SELECT id FROM tarefas WHERE id=?').get(req.params.id)) return res.status(404).json({erro:'Não encontrada'});
    const {nome,categoria,descricao}=req.body;
    db.prepare('UPDATE tarefas SET nome=COALESCE(?,nome),categoria=COALESCE(?,categoria),descricao=COALESCE(?,descricao) WHERE id=?').run(nome,categoria,descricao,req.params.id);
    res.json(db.prepare('SELECT * FROM tarefas WHERE id=?').get(req.params.id));
  },
  remover(req, res) {
    if(!db.prepare('DELETE FROM tarefas WHERE id=?').run(req.params.id).changes) return res.status(404).json({erro:'Não encontrada'});
    res.json({mensagem:'Tarefa removida'});
  }
};
CTEOF

cat << 'CTEOF' > src/controllers/ExecucoesController.js
const db = require('../database');
const VALID_STATUS = ['pendente','em_andamento','concluida','bloqueada'];
module.exports = {
  listar(req, res) {
    const {empresa_id,tarefa_id,status,categoria}=req.query;
    let q=`SELECT e.*, em.nome AS empresa_nome, em.regime, t.nome AS tarefa_nome, t.categoria FROM execucoes e JOIN empresas em ON em.id=e.empresa_id JOIN tarefas t ON t.id=e.tarefa_id WHERE 1=1`;
    const p=[];
    if(empresa_id){q+=' AND e.empresa_id=?';p.push(empresa_id);}
    if(tarefa_id){q+=' AND e.tarefa_id=?';p.push(tarefa_id);}
    if(status){q+=' AND e.status=?';p.push(status);}
    if(categoria){q+=' AND t.categoria=?';p.push(categoria);}
    res.json(db.prepare(q+' ORDER BY em.nome,t.categoria,t.nome').all(...p));
  },
  buscar(req, res) {
    const r=db.prepare('SELECT e.*,em.nome AS empresa_nome,t.nome AS tarefa_nome,t.categoria FROM execucoes e JOIN empresas em ON em.id=e.empresa_id JOIN tarefas t ON t.id=e.tarefa_id WHERE e.id=?').get(req.params.id);
    if(!r) return res.status(404).json({erro:'Não encontrada'});
    res.json(r);
  },
  atualizar(req, res) {
    if(!db.prepare('SELECT id FROM execucoes WHERE id=?').get(req.params.id)) return res.status(404).json({erro:'Não encontrada'});
    const {o_que_foi_feito,quando,observacoes,status,responsavel}=req.body;
    if(status&&!VALID_STATUS.includes(status)) return res.status(400).json({erro:'Status inválido'});
    db.prepare(`UPDATE execucoes SET o_que_foi_feito=COALESCE(?,o_que_foi_feito),quando=COALESCE(?,quando),observacoes=COALESCE(?,observacoes),status=COALESCE(?,status),responsavel=COALESCE(?,responsavel),atualizado_em=datetime('now','localtime') WHERE id=?`).run(o_que_foi_feito,quando,observacoes,status,responsavel,req.params.id);
    res.json(db.prepare('SELECT e.*,em.nome AS empresa_nome,t.nome AS tarefa_nome,t.categoria FROM execucoes e JOIN empresas em ON em.id=e.empresa_id JOIN tarefas t ON t.id=e.tarefa_id WHERE e.id=?').get(req.params.id));
  },
  reset(req, res) {
    const {empresa_id}=req.body;
    if(!empresa_id) return res.status(400).json({erro:'empresa_id obrigatório'});
    db.prepare("UPDATE execucoes SET status='pendente',o_que_foi_feito=NULL,quando=NULL,observacoes=NULL,responsavel=NULL,atualizado_em=datetime('now','localtime') WHERE empresa_id=?").run(empresa_id);
    res.json({mensagem:'Execuções reiniciadas'});
  }
};
CTEOF

cat << 'CTEOF' > src/controllers/HistoricoController.js
const db = require('../database');
const VALID_STATUS = ['pendente','em_andamento','concluida','bloqueada'];
module.exports = {
  listarMeses(req, res) {
    res.json(db.prepare('SELECT DISTINCT mes_referencia FROM historico ORDER BY mes_referencia DESC').all().map(r=>r.mes_referencia));
  },
  resumo(req, res) {
    res.json(db.prepare(`SELECT mes_referencia, COUNT(*) AS total, SUM(CASE WHEN status='concluida' THEN 1 ELSE 0 END) AS concluidas, SUM(CASE WHEN status='pendente' THEN 1 ELSE 0 END) AS pendentes, SUM(CASE WHEN status='bloqueada' THEN 1 ELSE 0 END) AS bloqueadas, COUNT(DISTINCT empresa_id) AS empresas, ROUND(100.0*SUM(CASE WHEN status='concluida' THEN 1 ELSE 0 END)/COUNT(*),1) AS percentual FROM historico GROUP BY mes_referencia ORDER BY mes_referencia DESC`).all());
  },
  listar(req, res) {
    const {mes_referencia,empresa_id,status,categoria}=req.query;
    let q='SELECT * FROM historico WHERE 1=1'; const p=[];
    if(mes_referencia){q+=' AND mes_referencia=?';p.push(mes_referencia);}
    if(empresa_id){q+=' AND empresa_id=?';p.push(empresa_id);}
    if(status){q+=' AND status=?';p.push(status);}
    if(categoria){q+=' AND categoria=?';p.push(categoria);}
    res.json(db.prepare(q+' ORDER BY empresa_nome,categoria,tarefa_nome').all(...p));
  },
  atualizar(req, res) {
    if(!db.prepare('SELECT id FROM historico WHERE id=?').get(req.params.id)) return res.status(404).json({erro:'Não encontrado'});
    const {o_que_foi_feito,quando,observacoes,status,responsavel}=req.body;
    if(status&&!VALID_STATUS.includes(status)) return res.status(400).json({erro:'Status inválido'});
    db.prepare('UPDATE historico SET o_que_foi_feito=COALESCE(?,o_que_foi_feito),quando=COALESCE(?,quando),observacoes=COALESCE(?,observacoes),status=COALESCE(?,status),responsavel=COALESCE(?,responsavel) WHERE id=?').run(o_que_foi_feito,quando,observacoes,status,responsavel,req.params.id);
    res.json(db.prepare('SELECT * FROM historico WHERE id=?').get(req.params.id));
  },
  fecharMes(req, res) {
    const {mes_referencia}=req.body;
    if(!mes_referencia||!/^\d{4}-\d{2}$/.test(mes_referencia)) return res.status(400).json({erro:'mes_referencia inválido'});
    const execs=db.prepare('SELECT e.*,em.nome AS empresa_nome,t.nome AS tarefa_nome,t.categoria FROM execucoes e JOIN empresas em ON em.id=e.empresa_id JOIN tarefas t ON t.id=e.tarefa_id').all();
    const iH=db.prepare('INSERT INTO historico (empresa_id,tarefa_id,empresa_nome,tarefa_nome,categoria,mes_referencia,o_que_foi_feito,quando,observacoes,status,responsavel) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    db.transaction(()=>{
      execs.forEach(e=>iH.run(e.empresa_id,e.tarefa_id,e.empresa_nome,e.tarefa_nome,e.categoria,mes_referencia,e.o_que_foi_feito,e.quando,e.observacoes,e.status,e.responsavel));
      db.prepare("UPDATE execucoes SET status='pendente',o_que_foi_feito=NULL,quando=NULL,observacoes=NULL,responsavel=NULL,atualizado_em=datetime('now','localtime')").run();
    })();
    res.json({mensagem:`Mês arquivado.`,total:execs.length});
  }
};
CTEOF

cat << 'CTEOF' > src/controllers/DashboardController.js
const db = require('../database');
const pct = (d,t) => t > 0 ? Math.round(d/t*100) : 0;
module.exports = {
  resumo(req, res) {
    const totalEmpresas   = db.prepare("SELECT COUNT(*) AS n FROM empresas WHERE ativo=1").get().n;
    const totalTarefas    = db.prepare("SELECT COUNT(*) AS n FROM tarefas").get().n;
    const totalExecucoes  = db.prepare("SELECT COUNT(*) AS n FROM execucoes").get().n;
    const totalConcluidas = db.prepare("SELECT COUNT(*) AS n FROM execucoes WHERE status='concluida'").get().n;
    const porTarefa = db.prepare(`SELECT t.id, t.nome, t.categoria, COUNT(e.id) AS total, SUM(CASE WHEN e.status='concluida' THEN 1 ELSE 0 END) AS concluidas, SUM(CASE WHEN e.status='em_andamento' THEN 1 ELSE 0 END) AS em_andamento, SUM(CASE WHEN e.status='pendente' THEN 1 ELSE 0 END) AS pendentes, SUM(CASE WHEN e.status='bloqueada' THEN 1 ELSE 0 END) AS bloqueadas, ROUND(100.0*SUM(CASE WHEN e.status='concluida' THEN 1 ELSE 0 END)/MAX(COUNT(e.id),1),1) AS percentual FROM tarefas t JOIN empresa_tarefas et ON et.tarefa_id=t.id AND et.ativo=1 LEFT JOIN execucoes e ON e.tarefa_id=t.id AND e.empresa_id=et.empresa_id LEFT JOIN empresas em ON em.id=et.empresa_id AND em.ativo=1 WHERE em.id IS NOT NULL GROUP BY t.id ORDER BY t.categoria, percentual DESC`).all();
    const porEmpresa = db.prepare(`SELECT em.id, em.nome, em.regime, COUNT(e.id) AS total, SUM(CASE WHEN e.status='concluida' THEN 1 ELSE 0 END) AS concluidas, SUM(CASE WHEN e.status='em_andamento' THEN 1 ELSE 0 END) AS em_andamento, SUM(CASE WHEN e.status='pendente' THEN 1 ELSE 0 END) AS pendentes, SUM(CASE WHEN e.status='bloqueada' THEN 1 ELSE 0 END) AS bloqueadas, ROUND(100.0*SUM(CASE WHEN e.status='concluida' THEN 1 ELSE 0 END)/MAX(COUNT(e.id),1),1) AS percentual FROM empresas em JOIN empresa_tarefas et ON et.empresa_id=em.id AND et.ativo=1 LEFT JOIN execucoes e ON e.empresa_id=em.id AND e.tarefa_id=et.tarefa_id WHERE em.ativo=1 GROUP BY em.id ORDER BY percentual DESC`).all();
    const porCategoria = db.prepare(`SELECT t.categoria, COUNT(e.id) AS total, SUM(CASE WHEN e.status='concluida' THEN 1 ELSE 0 END) AS concluidas, ROUND(100.0*SUM(CASE WHEN e.status='concluida' THEN 1 ELSE 0 END)/MAX(COUNT(e.id),1),1) AS percentual FROM tarefas t JOIN empresa_tarefas et ON et.tarefa_id=t.id AND et.ativo=1 LEFT JOIN execucoes e ON e.tarefa_id=t.id AND e.empresa_id=et.empresa_id LEFT JOIN empresas em ON em.id=et.empresa_id AND em.ativo=1 WHERE em.id IS NOT NULL GROUP BY t.categoria ORDER BY percentual DESC`).all();
    const recentes = db.prepare(`SELECT e.id,e.status,e.o_que_foi_feito,e.quando,e.responsavel,e.atualizado_em, em.nome AS empresa_nome,t.nome AS tarefa_nome,t.categoria FROM execucoes e JOIN empresas em ON em.id=e.empresa_id JOIN tarefas t ON t.id=e.tarefa_id WHERE e.status!='pendente' ORDER BY e.atualizado_em DESC LIMIT 15`).all();
    res.json({resumo:{totalEmpresas,totalTarefas,totalExecucoes,totalConcluidas,percentualGeral:pct(totalConcluidas,totalExecucoes)},porTarefa,porEmpresa,porCategoria,recentes});
  },
  matrix(req, res) {
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
  }
};
CTEOF

cat << 'CTEOF' > src/controllers/ConfiguracoesController.js
const db = require('../database');
module.exports = {
  buscar(req, res) {
    res.json(db.prepare('SELECT * FROM configuracoes LIMIT 1').get() || { nome_escritorio: 'Escritório de Contabilidade' });
  },
  atualizar(req, res) {
    const {nome_escritorio} = req.body;
    if (!nome_escritorio) return res.status(400).json({erro:'Nome obrigatório'});
    db.prepare('UPDATE configuracoes SET nome_escritorio=?').run(nome_escritorio);
    res.json({mensagem:'Configurações atualizadas', nome_escritorio});
  }
};
CTEOF

# 3. Routes
cat << 'RTEOF' > src/routes/empresas.routes.js
const { Router } = require('express');
const EmpresasController = require('../controllers/EmpresasController');
const router = Router();
router.get('/', EmpresasController.listar);
router.post('/', EmpresasController.criar);
router.post('/import', EmpresasController.importar);
router.get('/:id', EmpresasController.buscar);
router.put('/:id', EmpresasController.atualizar);
router.delete('/:id', EmpresasController.remover);
module.exports = router;
RTEOF

cat << 'RTEOF' > src/routes/tarefas.routes.js
const { Router } = require('express');
const TarefasController = require('../controllers/TarefasController');
const router = Router();
router.get('/', TarefasController.listar);
router.post('/', TarefasController.criar);
router.get('/:id', TarefasController.buscar);
router.put('/:id', TarefasController.atualizar);
router.delete('/:id', TarefasController.remover);
module.exports = router;
RTEOF

cat << 'RTEOF' > src/routes/execucoes.routes.js
const { Router } = require('express');
const ExecucoesController = require('../controllers/ExecucoesController');
const router = Router();
router.get('/', ExecucoesController.listar);
router.post('/reset', ExecucoesController.reset);
router.get('/:id', ExecucoesController.buscar);
router.put('/:id', ExecucoesController.atualizar);
module.exports = router;
RTEOF

cat << 'RTEOF' > src/routes/historico.routes.js
const { Router } = require('express');
const HistoricoController = require('../controllers/HistoricoController');
const router = Router();
router.get('/', HistoricoController.listar);
router.get('/meses', HistoricoController.listarMeses);
router.get('/resumo', HistoricoController.resumo);
router.put('/:id', HistoricoController.atualizar);
module.exports = router;
RTEOF

cat << 'RTEOF' > src/routes/mes.routes.js
const { Router } = require('express');
const HistoricoController = require('../controllers/HistoricoController');
const router = Router();
router.post('/fechar', HistoricoController.fecharMes);
module.exports = router;
RTEOF

cat << 'RTEOF' > src/routes/dashboard.routes.js
const { Router } = require('express');
const DashboardController = require('../controllers/DashboardController');
const router = Router();
router.get('/', DashboardController.resumo);
router.get('/matrix', DashboardController.matrix);
module.exports = router;
RTEOF

cat << 'RTEOF' > src/routes/configuracoes.routes.js
const { Router } = require('express');
const ConfiguracoesController = require('../controllers/ConfiguracoesController');
const router = Router();
router.get('/', ConfiguracoesController.buscar);
router.put('/', ConfiguracoesController.atualizar);
module.exports = router;
RTEOF

cat << 'RTEOF' > src/routes/index.js
const { Router } = require('express');
const empresasRoutes = require('./empresas.routes');
const tarefasRoutes = require('./tarefas.routes');
const execucoesRoutes = require('./execucoes.routes');
const historicoRoutes = require('./historico.routes');
const mesRoutes = require('./mes.routes');
const dashboardRoutes = require('./dashboard.routes');
const configuracoesRoutes = require('./configuracoes.routes');
const router = Router();
router.use('/empresas', empresasRoutes);
router.use('/tarefas', tarefasRoutes);
router.use('/execucoes', execucoesRoutes);
router.use('/historico', historicoRoutes);
router.use('/mes', mesRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/configuracoes', configuracoesRoutes);
module.exports = router;
RTEOF

# 4. server.js Update
cat << 'SVREOF' > server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const routes = require('./src/routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', routes);

app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🚀 Servidor rodando em http://localhost:${PORT}`));
SVREOF

sh ./setup_backend.sh
