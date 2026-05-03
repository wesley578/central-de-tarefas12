const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const crypto  = require('crypto');
const db      = require('../db');
const { auth } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(auth(['admin']));

// ─── Criptografia local (AES-256-CBC via ENCRYPTION_KEY do .env) ──────────────
function getKey() {
  const k = process.env.ENCRYPTION_KEY || '';
  return Buffer.from(k.substring(0, 64), 'hex');
}

function encrypt(texto) {
  const iv      = crypto.randomBytes(16);
  const cipher  = crypto.createCipheriv('aes-256-cbc', getKey(), iv);
  const content = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]).toString('hex');
  return { content, iv: iv.toString('hex') };
}

function decrypt(content, ivHex) {
  const iv       = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', getKey(), iv);
  return Buffer.concat([decipher.update(Buffer.from(content, 'hex')), decipher.final()]).toString('utf8');
}

// ─── Migração da tabela ───────────────────────────────────────────────────────
db.prepare(`
  CREATE TABLE IF NOT EXISTS certificados_digital (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa_id INTEGER NOT NULL UNIQUE,
    pfx_base64 TEXT NOT NULL,
    senha_enc  TEXT NOT NULL,
    iv         TEXT NOT NULL,
    validade   TEXT,
    atualizado_em TEXT,
    FOREIGN KEY (empresa_id) REFERENCES empresas(id)
  )
`).run();

// ─── GET /api/certificados ────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT e.id, e.nome, e.cnpj,
           c.validade, c.atualizado_em,
           CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END as configurado
    FROM empresas e
    LEFT JOIN certificados_digital c ON c.empresa_id = e.id
    WHERE e.ativo = 1
    ORDER BY e.nome
  `).all();
  res.json(rows);
});

// ─── PUT /api/certificados/:id ────────────────────────────────────────────────
router.put('/:id', upload.single('pfx'), (req, res) => {
  const empresaId = req.params.id;
  const { senha, validade } = req.body;

  if (!req.file) return res.status(400).json({ erro: 'Arquivo .pfx não enviado.' });
  if (!senha)    return res.status(400).json({ erro: 'Senha do certificado é obrigatória.' });

  const pfxBase64 = req.file.buffer.toString('base64');
  const { content, iv } = encrypt(senha);

  db.prepare(`
    INSERT OR REPLACE INTO certificados_digital
      (empresa_id, pfx_base64, senha_enc, iv, validade, atualizado_em)
    VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
  `).run(empresaId, pfxBase64, content, iv, validade || null);

  res.json({ mensagem: 'Certificado salvo com sucesso.' });
});

// ─── DELETE /api/certificados/:id ────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM certificados_digital WHERE empresa_id = ?').run(req.params.id);
  res.json({ mensagem: 'Certificado removido.' });
});

// ─── Helper exportado para sefaz-routes.js ───────────────────────────────────
function getCertificado(cnpjLimpo) {
  const row = db.prepare(`
    SELECT c.pfx_base64, c.senha_enc, c.iv
    FROM certificados_digital c
    JOIN empresas e ON e.id = c.empresa_id
    WHERE replace(replace(replace(e.cnpj,'.',''),'/',''),'-','') = ?
  `).get(cnpjLimpo);

  if (!row) return null;
  const senha     = decrypt(row.senha_enc, row.iv);
  const pfxBuffer = Buffer.from(row.pfx_base64, 'base64');
  return { pfxBuffer, senha };
}

module.exports = router;
module.exports.getCertificado = getCertificado;
