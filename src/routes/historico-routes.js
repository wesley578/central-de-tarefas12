const express = require('express');
const router = express.Router();
const db = require('../db');
const { auth } = require('../middleware/auth');
const { ExecucaoUpdateSchema } = require('../schemas');

router.use(auth(['admin', 'colaborador']));

// GET /api/historico/meses
router.get('/meses', (req, res) => {
  res.json(db.prepare('SELECT DISTINCT mes_referencia FROM historico ORDER BY mes_referencia DESC').all().map(r => r.mes_referencia));
});

// GET /api/historico/resumo
router.get('/resumo', (req, res) => {
  res.json(db.prepare(`SELECT mes_referencia, COUNT(*) AS total, SUM(CASE WHEN status='concluida' THEN 1 ELSE 0 END) AS concluidas, SUM(CASE WHEN status='pendente' THEN 1 ELSE 0 END) AS pendentes, SUM(CASE WHEN status='bloqueada' THEN 1 ELSE 0 END) AS bloqueadas, COUNT(DISTINCT empresa_id) AS empresas, ROUND(100.0*SUM(CASE WHEN status='concluida' THEN 1 ELSE 0 END)/COUNT(*),1) AS percentual FROM historico GROUP BY mes_referencia ORDER BY mes_referencia DESC`).all());
});

// GET /api/historico
router.get('/', (req, res) => {
  const { mes_referencia, empresa_id, status, categoria, page = 1, limit = 50 } = req.query;
  const pPage = Math.max(1, +page), pLimit = Math.max(1, +limit), offset = (pPage - 1) * pLimit;
  
  let q = 'SELECT * FROM historico WHERE 1=1';
  let qC = 'SELECT COUNT(*) AS total FROM historico WHERE 1=1';
  const p = [];
  
  if (mes_referencia) { q += ' AND mes_referencia=?'; qC += ' AND mes_referencia=?'; p.push(mes_referencia); }
  if (empresa_id) { q += ' AND empresa_id=?'; qC += ' AND empresa_id=?'; p.push(empresa_id); }
  if (status) { q += ' AND status=?'; qC += ' AND status=?'; p.push(status); }
  if (categoria) { q += ' AND categoria=?'; qC += ' AND categoria=?'; p.push(categoria); }
  
  const total = db.prepare(qC).get(...p).total;
  const data = db.prepare(q + ' ORDER BY empresa_nome,categoria,tarefa_nome LIMIT ? OFFSET ?').all(...p, pLimit, offset);
  
  res.json({ data, total, page: pPage, limit: pLimit });
});

// PUT /api/historico/:id
router.put('/:id', (req, res) => {
  if (!db.prepare('SELECT id FROM historico WHERE id=?').get(req.params.id)) {
    return res.status(404).json({ erro: 'Não encontrado' });
  }
  
  const parsed = ExecucaoUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erro: parsed.error.errors[0].message });
  
  const { o_que_foi_feito, quando, observacoes, status, responsavel } = parsed.data;
  db.prepare('UPDATE historico SET o_que_foi_feito=COALESCE(?,o_que_foi_feito),quando=COALESCE(?,quando),observacoes=COALESCE(?,observacoes),status=COALESCE(?,status),responsavel=COALESCE(?,responsavel) WHERE id=?')
    .run(o_que_foi_feito, quando, observacoes, status, responsavel, req.params.id);
    
  res.json(db.prepare('SELECT * FROM historico WHERE id=?').get(req.params.id));
});

module.exports = router;
