const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'super_secreto_key';

const auth = (roles = []) => (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ erro: 'Acesso negado' });
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    if (roles.length && !roles.includes(decoded.role)) {
      return res.status(403).json({ erro: 'Proibido' });
    }
    next();
  } catch (e) {
    res.status(401).json({ erro: 'Token inválido' });
  }
};

const autenticar   = auth();
const requireAdmin = auth(['admin']);

module.exports = {
  auth,
  autenticar,
  requireAdmin,
  JWT_SECRET
};
