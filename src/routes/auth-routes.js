const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { auth, JWT_SECRET } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, senha } = req.body;
  const user = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  
  if (!user || !bcrypt.compareSync(senha, user.senha_hash)) {
    return res.status(401).json({ erro: 'Credenciais inválidas' });
  }
  
  const token = jwt.sign(
    { id: user.id, nome: user.nome, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  
  res.json({
    token,
    user: { id: user.id, nome: user.nome, role: user.role }
  });
});

// GET /api/auth/me
router.get('/me', auth(), (req, res) => {
  res.json(req.user);
});

module.exports = router;
