const express = require('express');
const router = express.Router();
const db = require('../db');
const { auth } = require('../middleware/auth');

// GET /api/configuracoes
router.get('/configuracoes', auth(['admin']), (req, res) => {
  const row = db.prepare('SELECT * FROM configuracoes LIMIT 1').get();
  res.json(row);
});

// PUT /api/configuracoes
router.put('/configuracoes', auth(['admin']), (req, res) => {
  const { nome_escritorio, pasta_download_padrao } = req.body;
  if (!nome_escritorio) return res.status(400).json({ erro: 'nome_escritorio obrigatório' });
  
  db.prepare('UPDATE configuracoes SET nome_escritorio = ?, pasta_download_padrao = ?')
    .run(nome_escritorio, pasta_download_padrao || null);
    
  res.json({ mensagem: 'Configuração atualizada' });
});

// GET /api/competencia
router.get('/competencia', auth(['admin', 'colaborador']), (req, res) => {
  const cfg = db.prepare('SELECT competencia_ativa FROM configuracoes LIMIT 1').get();
  res.json({ competencia_ativa: cfg?.competencia_ativa || new Date().toISOString().slice(0, 7) });
});

// PUT /api/competencia
router.put('/competencia', auth(['admin']), (req, res) => {
  const { competencia_ativa } = req.body;
  if (!competencia_ativa || !/^\d{4}-\d{2}$/.test(competencia_ativa))
    return res.status(400).json({ erro: 'competencia_ativa obrigatória no formato YYYY-MM' });
  
  db.prepare('UPDATE configuracoes SET competencia_ativa = ?').run(competencia_ativa);
  res.json({ mensagem: 'Competência atualizada.', competencia_ativa });
});

module.exports = router;
