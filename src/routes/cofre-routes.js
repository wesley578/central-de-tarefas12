const express = require('express');
const router = express.Router();
const db = require('../db');
const { auth } = require('../middleware/auth');
const { encrypt } = require('../nfse');

router.use(auth(['admin']));

// GET /api/cofre-nfse
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT e.id, e.nome, e.cnpj, c.usuario, c.atualizado_em,
           CASE WHEN c.usuario IS NOT NULL THEN 1 ELSE 0 END as configurado
    FROM empresas e
    LEFT JOIN credenciais_nfse c ON c.empresa_id = e.id
    WHERE e.ativo = 1
    ORDER BY e.nome
  `).all();
  res.json(rows);
});

// PUT /api/cofre-nfse/:id
router.put('/:id', (req, res) => {
  const empresaId = req.params.id;
  const { usuario, senha } = req.body;

  if (!usuario || !senha) {
    return res.status(400).json({ erro: 'Usuário e senha são obrigatórios.' });
  }

  const { content, iv } = encrypt(senha);

  db.prepare(`
    INSERT OR REPLACE INTO credenciais_nfse (empresa_id, usuario, senha_enc, iv, atualizado_em)
    VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
  `).run(empresaId, usuario, content, iv);

  res.json({ mensagem: 'Credenciais salvas com sucesso no cofre.' });
});

// DELETE /api/cofre-nfse/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM credenciais_nfse WHERE empresa_id = ?').run(req.params.id);
  res.json({ mensagem: 'Credenciais removidas do cofre.' });
});

module.exports = router;
