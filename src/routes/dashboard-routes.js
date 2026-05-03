const express = require('express');
const router = express.Router();
const db = require('../db');
const { auth } = require('../middleware/auth');

router.use(auth(['admin', 'colaborador']));

// GET /api/dashboard/sla
router.get('/sla', (req, res) => {
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

// GET /api/dashboard/matrix
router.get('/matrix', (req, res) => {
  const empresas = db.prepare("SELECT id, nome FROM empresas WHERE ativo=1 ORDER BY nome").all();
  const tarefas = db.prepare("SELECT id, nome, categoria FROM tarefas ORDER BY categoria, nome").all();
  const execs = db.prepare("SELECT empresa_id, tarefa_id, status FROM execucoes").all();

  const matrix = {};
  execs.forEach(ex => {
    matrix[`${ex.empresa_id}_${ex.tarefa_id}`] = ex.status;
  });

  res.json({ empresas, tarefas, matrix });
});

// GET /api/dashboard
router.get('/', (req, res) => {
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
    SELECT e.*, em.nome AS empresa_nome, t.nome AS tarefa_nome
    FROM execucoes e
    JOIN empresas em ON em.id=e.empresa_id
    JOIN tarefas t ON t.id=e.tarefa_id
    WHERE e.status='concluida'
    ORDER BY e.atualizado_em DESC LIMIT 10
  `).all();

  res.json({
    resumo: { 
      totalEmpresas, 
      totalTarefas, 
      totalExecucoes, 
      totalConcluidas, 
      percentualGeral: Math.round(totalConcluidas/Math.max(totalExecucoes,1)*100) 
    },
    porTarefa,
    porEmpresa,
    porCategoria,
    recentes
  });
});

module.exports = router;
