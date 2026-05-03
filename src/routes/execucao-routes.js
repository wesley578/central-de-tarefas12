const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { ExecucaoUpdateSchema } = require('../schemas');

const upload = multer({ dest: path.join(__dirname, '../../public/uploads/') });

// GET /api/execucoes
router.get('/', auth(['admin', 'colaborador']), (req, res) => {
  const { empresa_id, tarefa_id, status, categoria, page = 1, limit = 50 } = req.query;
  const pPage = Math.max(1, +page), pLimit = Math.max(1, +limit), offset = (pPage - 1) * pLimit;
  
  let q = `SELECT e.*, em.nome AS empresa_nome, em.regime, t.nome AS tarefa_nome, t.categoria FROM execucoes e JOIN empresas em ON em.id=e.empresa_id JOIN tarefas t ON t.id=e.tarefa_id WHERE 1=1`;
  let qC = `SELECT COUNT(*) AS total FROM execucoes e JOIN empresas em ON em.id=e.empresa_id JOIN tarefas t ON t.id=e.tarefa_id WHERE 1=1`;
  const p = [];
  
  if (empresa_id) { q += ' AND e.empresa_id=?'; qC += ' AND e.empresa_id=?'; p.push(empresa_id); }
  if (tarefa_id) { q += ' AND e.tarefa_id=?'; qC += ' AND e.tarefa_id=?'; p.push(tarefa_id); }
  if (status) { q += ' AND e.status=?'; qC += ' AND e.status=?'; p.push(status); }
  if (categoria) { q += ' AND t.categoria=?'; qC += ' AND t.categoria=?'; p.push(categoria); }
  
  const total = db.prepare(qC).get(...p).total;
  const data = db.prepare(q + ' ORDER BY em.nome,t.categoria,t.nome LIMIT ? OFFSET ?').all(...p, pLimit, offset);
  
  res.json({ data, total, page: pPage, limit: pLimit });
});

// GET /api/execucoes/:id
router.get('/:id', auth(['admin', 'colaborador']), (req, res) => {
  const r = db.prepare('SELECT e.*,em.nome AS empresa_nome,t.nome AS tarefa_nome,t.categoria FROM execucoes e JOIN empresas em ON em.id=e.empresa_id JOIN tarefas t ON t.id=e.tarefa_id WHERE e.id=?').get(req.params.id);
  if (!r) return res.status(404).json({ erro: 'Não encontrada' });
  res.json(r);
});

// PUT /api/execucoes/:id
router.put('/:id', auth(['admin', 'colaborador']), (req, res) => {
  if (!db.prepare('SELECT id FROM execucoes WHERE id=?').get(req.params.id)) {
    return res.status(404).json({ erro: 'Não encontrada' });
  }
  
  const parsed = ExecucaoUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erro: parsed.error.errors[0].message });
  
  const { o_que_foi_feito, quando, observacoes, status } = parsed.data;
  const responsavel = req.user.nome;
  
  db.prepare(`UPDATE execucoes SET o_que_foi_feito=COALESCE(?,o_que_foi_feito),quando=COALESCE(?,quando),observacoes=COALESCE(?,observacoes),status=COALESCE(?,status),responsavel=COALESCE(?,responsavel),atualizado_em=datetime('now','localtime') WHERE id=?`)
    .run(o_que_foi_feito, quando, observacoes, status, responsavel, req.params.id);
    
  res.json(db.prepare('SELECT e.*,em.nome AS empresa_nome,t.nome AS tarefa_nome,t.categoria FROM execucoes e JOIN empresas em ON em.id=e.empresa_id JOIN tarefas t ON t.id=e.tarefa_id WHERE e.id=?').get(req.params.id));
});

// POST /api/execucoes/reset
router.post('/reset', auth(['admin']), (req, res) => {
  const { empresa_id } = req.body;
  if (!empresa_id) return res.status(400).json({ erro: 'empresa_id obrigatório' });
  
  db.prepare("UPDATE execucoes SET status='pendente',o_que_foi_feito=NULL,quando=NULL,observacoes=NULL,responsavel=NULL,comprovante=NULL,atualizado_em=datetime('now','localtime') WHERE empresa_id=?").run(empresa_id);
  res.json({ mensagem: 'Execuções reiniciadas' });
});

// POST /api/execucoes/:id/comprovante
router.post('/:id/comprovante', auth(['admin', 'colaborador']), upload.single('comprovante'), (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado' });
  
  db.prepare('UPDATE execucoes SET comprovante = ? WHERE id = ?').run(req.file.filename, req.params.id);
  res.json({ mensagem: 'Comprovante salvo', arquivo: req.file.filename });
});

module.exports = router;
