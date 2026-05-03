const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { consultarChaveSefaz } = require('../services/sefazService');
const { getCertificado } = require('./certificado-routes');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

// POST /api/sefaz/consulta
// Body: multipart — arquivo .txt com chaves + competencia (opcional)
router.post('/consulta', auth(['admin']), upload.single('chaves'), async (req, res) => {
  const logs = [];

  try {
    if (!req.file) return res.status(400).json({ erro: 'Arquivo .txt com chaves não enviado.' });

    const config = db.prepare('SELECT * FROM configuracoes LIMIT 1').get() || {};
    const pastaBase   = config.pasta_download_padrao || path.join(__dirname, '../../public/downloads');
    const competencia = req.body?.competencia || config.competencia_ativa || new Date().toISOString().slice(0, 7);

    logs.push(`Competência: ${competencia}`);
    logs.push(`Pasta de destino: ${pastaBase}`);

    // Extrai chaves do arquivo (uma por linha, ignora linhas que não são 44 dígitos)
    const texto = req.file.buffer.toString('utf-8');
    const chaves = texto
      .split(/\r?\n/)
      .map(l => l.trim().replace(/\D/g, ''))
      .filter(l => l.length === 44);

    if (chaves.length === 0) {
      return res.status(400).json({ erro: 'Nenhuma chave de acesso válida encontrada no arquivo.' });
    }

    logs.push(`Chaves encontradas no arquivo: ${chaves.length}`);

    let baixados = 0;
    let erros    = 0;
    let pulados  = 0;

    for (const chave of chaves) {
      // CNPJ destinatário: posições 20-33 da chave (índice base 0)
      // Estrutura da chave: cUF(2) + AAMM(4) + CNPJ_emit(14) + mod(2) + serie(3) + nNF(9) + tpEmis(1) + cNF(8) + cDV(1)
      // O CNPJ do destinatário NÃO está na chave — está no XML
      // Usamos o CNPJ do emitente para identificar qual empresa tem certificado
      // (a nota é DE alguém, e está no painel da empresa destinatária)
      // Na prática: a chave identifica o emitente, mas queremos baixar para o destinatário
      // Por isso vamos tentar cada certificado disponível até obter sucesso,
      // ou deixar o usuário escolher a empresa ao enviar

      const cnpjEmitente = chave.substring(6, 20);
      const empresaAlvo = req.body?.empresa_id
        ? db.prepare('SELECT id, nome, cnpj FROM empresas WHERE id = ?').get(req.body.empresa_id)
        : null;

      // Tenta encontrar certificado — primeiro pela empresa selecionada, depois por qualquer disponível
      let cert = null;
      let empresaNome = null;
      let cnpjDest = null;

      if (empresaAlvo) {
        const cnpjLimpo = empresaAlvo.cnpj.replace(/\D/g, '');
        cert = getCertificado(cnpjLimpo);
        empresaNome = empresaAlvo.nome;
        cnpjDest = cnpjLimpo;
      } else {
        // Tenta todos os certificados cadastrados
        const certs = db.prepare(`
          SELECT e.nome, e.cnpj, c.pfx_base64, c.senha_enc, c.iv
          FROM certificados_digital c
          JOIN empresas e ON e.id = c.empresa_id
          WHERE e.ativo = 1
        `).all();

        for (const row of certs) {
          const { decrypt } = require('../nfse');
          const senha = decrypt(row.senha_enc, row.iv);
          const pfxBuffer = Buffer.from(row.pfx_base64, 'base64');
          cert = { pfxBuffer, senha };
          empresaNome = row.nome;
          cnpjDest = row.cnpj.replace(/\D/g, '');
          break; // usa o primeiro disponível — pode ser refinado
        }
      }

      if (!cert) {
        logs.push(`⚠️  Sem certificado disponível para consultar: ${chave.substring(0, 10)}...`);
        erros++;
        continue;
      }

      try {
        // Verifica se já existe
        const baseDir = path.join(pastaBase, 'fiscal', competencia, cnpjDest);
        const xmlPath = path.join(baseDir, `${chave}.xml`);

        if (fs.existsSync(xmlPath)) {
          logs.push(`⏭️  Já existe: ${chave.substring(0, 10)}...`);
          pulados++;
          continue;
        }

        logs.push(`🔍 Consultando SEFAZ: ${chave.substring(0, 10)}...`);
        const resultado = await consultarChaveSefaz(chave, cert.pfxBuffer, cert.senha);

        if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
        fs.writeFileSync(xmlPath, resultado.xml, 'utf-8');

        baixados++;
        logs.push(`✅ ${empresaNome} — XML salvo (${competencia}/${cnpjDest})`);

        // Pausa entre consultas para não sobrecarregar a SEFAZ
        await new Promise(r => setTimeout(r, 500));

      } catch (err) {
        erros++;
        logs.push(`❌ Erro em ${chave.substring(0, 10)}...: ${err.message}`);
      }
    }

    logs.push(`──────────────────────────────────`);
    logs.push(`Concluído: ${baixados} baixados | ${pulados} já existiam | ${erros} erros`);

    res.json({
      sucesso: true,
      mensagem: `${baixados} XMLs baixados da SEFAZ.`,
      detalhes: logs
    });

  } catch (error) {
    console.error('[SEFAZ Consulta Error]', error);
    res.status(500).json({ erro: 'Falha na consulta: ' + error.message });
  }
});

module.exports = router;
