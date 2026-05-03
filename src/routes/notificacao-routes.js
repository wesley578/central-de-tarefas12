const express = require('express');
const router = express.Router();
const db = require('../db');
const { auth } = require('../middleware/auth');

router.get('/', auth(), (req, res) => {
  const cfg = db.prepare('SELECT competencia_ativa FROM configuracoes LIMIT 1').get();
  const mesAtual = new Date().toISOString().slice(0, 7);
  const competencia = cfg?.competencia_ativa || mesAtual;
  const hoje = new Date().toISOString().slice(0, 10);

  const alerts = db.prepare(`
    SELECT 
      e.id, 
      em.nome AS empresa_nome, 
      t.nome AS tarefa_nome, 
      t.dia_vencimento,
      (? || '-' || printf('%02d', t.dia_vencimento)) AS data_vencimento,
      CASE WHEN (? || '-' || printf('%02d', t.dia_vencimento)) <= ? THEN 1 ELSE 0 END AS atrasada
    FROM execucoes e
    JOIN empresas em ON em.id = e.empresa_id
    JOIN tarefas t ON t.id = e.tarefa_id
    WHERE e.status != 'concluida'
      AND t.dia_vencimento IS NOT NULL
      AND (? || '-' || printf('%02d', t.dia_vencimento)) <= date(?, '+3 days')
    ORDER BY t.dia_vencimento ASC
  `).all(competencia, competencia, hoje, competencia, hoje);
  
  res.json(alerts);
});

module.exports = router;
