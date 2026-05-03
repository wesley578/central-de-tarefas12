const express = require('express');
const router = express.Router();
const db = require('../db');
const { auth } = require('../middleware/auth');
const { TarefaSchema } = require('../schemas');

// Todas as rotas aqui requerem admin
router.use(auth(['admin']));

// GET /api/tarefas
router.get('/', (req, res) => {
  const { categoria } = req.query;
  let q = 'SELECT * FROM tarefas';
  const p = [];
  if (categoria) {
    q += ' WHERE categoria=?';
    p.push(categoria);
  }
  res.json(db.prepare(q + ' ORDER BY categoria,nome').all(...p));
});

// GET /api/tarefas/:id
router.get('/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM tarefas WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ erro: 'Não encontrada' });
  res.json(r);
});

// POST /api/tarefas
router.post('/', (req, res) => {
  const parsed = TarefaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erro: parsed.error.errors[0].message });
  
  const { nome, categoria, descricao, dia_vencimento } = parsed.data;
  const tid = db.prepare('INSERT INTO tarefas (nome,categoria,descricao,dia_vencimento) VALUES(?,?,?,?)')
    .run(nome, categoria || null, descricao || null, dia_vencimento || null).lastInsertRowid;
    
  res.status(201).json(db.prepare('SELECT * FROM tarefas WHERE id=?').get(tid));
});

// PUT /api/tarefas/:id
router.put('/:id', (req, res) => {
  if (!db.prepare('SELECT id FROM tarefas WHERE id=?').get(req.params.id)) {
    return res.status(404).json({ erro: 'Não encontrada' });
  }
  
  const parsed = TarefaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erro: parsed.error.errors[0].message });
  
  const { nome, categoria, descricao, dia_vencimento } = parsed.data;
  db.prepare('UPDATE tarefas SET nome=COALESCE(?,nome),categoria=COALESCE(?,categoria),descricao=COALESCE(?,descricao),dia_vencimento=COALESCE(?,dia_vencimento) WHERE id=?')
    .run(nome, categoria, descricao, dia_vencimento, req.params.id);
    
  res.json(db.prepare('SELECT * FROM tarefas WHERE id=?').get(req.params.id));
});

// DELETE /api/tarefas/:id
router.delete('/:id', (req, res) => {
  if (!db.prepare('DELETE FROM tarefas WHERE id=?').run(req.params.id).changes) {
    return res.status(404).json({ erro: 'Não encontrada' });
  }
  res.json({ mensagem: 'Tarefa removida' });
});

module.exports = router;
