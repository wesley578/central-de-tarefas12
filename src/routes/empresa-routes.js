const express = require('express');
const router = express.Router();
const db = require('../db');
const { auth } = require('../middleware/auth');
const { EmpresaSchema, EmpresaUpdateSchema } = require('../schemas');

// Todas as rotas aqui requerem admin
router.use(auth(['admin']));

// GET /api/empresas
router.get('/', (req, res) => {
  const { ativo } = req.query;
  let q = 'SELECT * FROM empresas';
  const p = [];
  if (ativo !== undefined) {
    q += ' WHERE ativo=?';
    p.push(Number(ativo));
  }
  res.json(db.prepare(q + ' ORDER BY nome').all(...p));
});

// GET /api/empresas/:id
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM empresas WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ erro: 'Empresa não encontrada' });
  
  const tarefas = db.prepare(`
    SELECT t.id, t.nome, t.categoria, t.descricao,
           COALESCE(et.ativo,0) AS habilitada
    FROM tarefas t
    LEFT JOIN empresa_tarefas et ON et.tarefa_id=t.id AND et.empresa_id=?
    ORDER BY t.categoria, t.nome
  `).all(req.params.id);
  
  res.json({ ...row, tarefas });
});

// POST /api/empresas
router.post('/', (req, res) => {
  const parsed = EmpresaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erro: parsed.error.errors[0].message });
  
  const { nome, cnpj, regime, tarefas_ids } = parsed.data;
  const allT = db.prepare('SELECT id FROM tarefas').all();
  const enabled = tarefas_ids ? new Set(tarefas_ids.map(Number)) : new Set();
  
  const eid = db.prepare('INSERT INTO empresas (nome,cnpj,regime) VALUES(?,?,?)')
    .run(nome, cnpj || null, regime || null).lastInsertRowid;
    
  const iET = db.prepare('INSERT OR REPLACE INTO empresa_tarefas (empresa_id,tarefa_id,ativo) VALUES(?,?,?)');
  const iX = db.prepare("INSERT OR IGNORE INTO execucoes (empresa_id,tarefa_id,status) VALUES(?,?,'pendente')");
  
  db.transaction(() => {
    allT.forEach(t => {
      const a = enabled.has(t.id) ? 1 : 0;
      iET.run(eid, t.id, a);
      if (a) iX.run(eid, t.id);
    });
  })();
  
  res.status(201).json(db.prepare('SELECT * FROM empresas WHERE id=?').get(eid));
});

// POST /api/empresas/import
router.post('/import', (req, res) => {
  const empresas = req.body;
  if (!Array.isArray(empresas)) return res.status(400).json({ erro: 'Formato inválido. Esperado um array.' });
  
  const allT = db.prepare('SELECT id FROM tarefas').all();
  const insertEmpresa = db.prepare('INSERT INTO empresas (nome,cnpj,regime) VALUES(?,?,?)');
  const iET = db.prepare('INSERT OR REPLACE INTO empresa_tarefas (empresa_id,tarefa_id,ativo) VALUES(?,?,?)');
  
  let count = 0;
  db.transaction(() => {
    for (const emp of empresas) {
      if (!emp.nome) continue;
      const eid = insertEmpresa.run(emp.nome, emp.cnpj || null, emp.regime || null).lastInsertRowid;
      allT.forEach(t => {
        iET.run(eid, t.id, 0);
      });
      count++;
    }
  })();
  
  res.status(201).json({ mensagem: `${count} empresas importadas com sucesso.` });
});

// PUT /api/empresas/:id
router.put('/:id', (req, res) => {
  const parsed = EmpresaUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erro: parsed.error.errors[0].message });
  
  const { nome, cnpj, regime, ativo, tarefas_ids } = parsed.data;
  if (!db.prepare('SELECT id FROM empresas WHERE id=?').get(req.params.id)) {
    return res.status(404).json({ erro: 'Empresa não encontrada' });
  }
  
  db.prepare('UPDATE empresas SET nome=COALESCE(?,nome),cnpj=COALESCE(?,cnpj),regime=COALESCE(?,regime),ativo=COALESCE(?,ativo) WHERE id=?')
    .run(nome, cnpj, regime, ativo, req.params.id);
    
  if (tarefas_ids !== undefined) {
    const allT = db.prepare('SELECT id FROM tarefas').all();
    const enabled = new Set(tarefas_ids.map(Number));
    const iET = db.prepare('INSERT OR REPLACE INTO empresa_tarefas (empresa_id,tarefa_id,ativo) VALUES(?,?,?)');
    const iX = db.prepare("INSERT OR IGNORE INTO execucoes (empresa_id,tarefa_id,status) VALUES(?,?,'pendente')");
    const dX = db.prepare('DELETE FROM execucoes WHERE empresa_id=? AND tarefa_id=?');
    
    db.transaction(() => {
      allT.forEach(t => {
        const a = enabled.has(t.id) ? 1 : 0;
        iET.run(req.params.id, t.id, a);
        if (a) iX.run(req.params.id, t.id);
        else dX.run(req.params.id, t.id);
      });
    })();
  }
  
  res.json(db.prepare('SELECT * FROM empresas WHERE id=?').get(req.params.id));
});

// DELETE /api/empresas/:id
router.delete('/:id', (req, res) => {
  if (!db.prepare('DELETE FROM empresas WHERE id=?').run(req.params.id).changes) {
    return res.status(404).json({ erro: 'Não encontrada' });
  }
  res.json({ mensagem: 'Empresa removida' });
});

module.exports = router;
