const express = require('express');
const router = express.Router();
const db = require('../db');
const { auth } = require('../middleware/auth');

router.use(auth(['admin']));

// POST /api/mes/fechar
router.post('/fechar', (req, res) => {
  const { mes_referencia } = req.body;
  if (!mes_referencia || !/^\d{4}-\d{2}$/.test(mes_referencia)) {
    return res.status(400).json({ erro: 'mes_referencia obrigatório no formato YYYY-MM' });
  }

  const jaFechado = db.prepare('SELECT COUNT(*) AS n FROM historico WHERE mes_referencia=?').get(mes_referencia);
  if (jaFechado.n > 0) {
    return res.status(409).json({ erro: `O mês ${mes_referencia} já foi fechado. Reabra-o antes de fazer alterações.` });
  }

  const execs = db.prepare('SELECT e.*,em.nome AS empresa_nome,t.nome AS tarefa_nome,t.categoria FROM execucoes e JOIN empresas em ON em.id=e.empresa_id JOIN tarefas t ON t.id=e.tarefa_id').all();
  const iH = db.prepare('INSERT INTO historico (empresa_id,tarefa_id,empresa_nome,tarefa_nome,categoria,mes_referencia,o_que_foi_feito,quando,observacoes,status,responsavel,comprovante) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');

  const [ano, mes] = mes_referencia.split('-').map(Number);
  const proxMes = mes === 12 ? 1 : mes + 1;
  const proxAno = mes === 12 ? ano + 1 : ano;
  const proxCompetencia = `${proxAno}-${String(proxMes).padStart(2, '0')}`;

  db.transaction(() => {
    execs.forEach(e => iH.run(e.empresa_id, e.tarefa_id, e.empresa_nome, e.tarefa_nome, e.categoria, mes_referencia, e.o_que_foi_feito, e.quando, e.observacoes, e.status, e.responsavel, e.comprovante));
    db.prepare("UPDATE execucoes SET status='pendente',o_que_foi_feito=NULL,quando=NULL,observacoes=NULL,responsavel=NULL,atualizado_em=datetime('now','localtime')").run();
    db.prepare("UPDATE configuracoes SET ultimo_mes_fechado=?, competencia_ativa=?").run(mes_referencia, proxCompetencia);
  })();
  
  res.json({ mensagem: `Mês ${mes_referencia} arquivado. Competência avançada para ${proxCompetencia}.`, total: execs.length, competencia_ativa: proxCompetencia });
});

// POST /api/mes/reabrir
router.post('/reabrir', (req, res) => {
  const { mes_referencia } = req.body;
  if (!mes_referencia || !/^\d{4}-\d{2}$/.test(mes_referencia)) {
    return res.status(400).json({ erro: 'mes_referencia obrigatório no formato YYYY-MM' });
  }

  const registros = db.prepare('SELECT * FROM historico WHERE mes_referencia=?').all(mes_referencia);
  if (!registros.length) return res.status(404).json({ erro: 'Nenhum registro encontrado para este mês.' });

  const upd = db.prepare(`UPDATE execucoes SET status=?,o_que_foi_feito=?,quando=?,observacoes=?,responsavel=?,comprovante=?,atualizado_em=datetime('now','localtime') WHERE empresa_id=? AND tarefa_id=?`);
  
  db.transaction(() => {
    registros.forEach(h => upd.run(h.status, h.o_que_foi_feito, h.quando, h.observacoes, h.responsavel, h.comprovante, h.empresa_id, h.tarefa_id));
    db.prepare('DELETE FROM historico WHERE mes_referencia=?').run(mes_referencia);
    db.prepare("UPDATE configuracoes SET ultimo_mes_fechado=NULL, competencia_ativa=? WHERE ultimo_mes_fechado=?").run(mes_referencia, mes_referencia);
  })();
  
  res.json({ mensagem: `Mês ${mes_referencia} reaberto.`, total: registros.length, competencia_ativa: mes_referencia });
});

module.exports = router;
