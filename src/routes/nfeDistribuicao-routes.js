const express  = require('express');
const router   = express.Router();
const fs       = require('fs');
const path     = require('path');
const db       = require('../db');
const { auth } = require('../middleware/auth');
const { consultarDistribuicao } = require('../services/nfeDistribuicaoService');
const { getCertificado }        = require('./certificado-routes');

// Garante tabela de controle de NSU por empresa
db.prepare(`
  CREATE TABLE IF NOT EXISTS nfe_distribuicao_nsu (
    empresa_id INTEGER PRIMARY KEY,
    ult_nsu    INTEGER NOT NULL DEFAULT 0,
    ultima_sync TEXT,
    FOREIGN KEY (empresa_id) REFERENCES empresas(id)
  )
`).run();

// GET /api/nfe-distribuicao/status
// Retorna status de sync por empresa (NSU atual, última sincronização)
router.get('/status', auth(['admin']), (req, res) => {
  const rows = db.prepare(`
    SELECT e.id, e.nome, e.cnpj,
           COALESCE(n.ult_nsu, 0) as ult_nsu,
           n.ultima_sync,
           CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END as tem_certificado
    FROM empresas e
    LEFT JOIN nfe_distribuicao_nsu n ON n.empresa_id = e.id
    LEFT JOIN certificados_digital c ON c.empresa_id = e.id
    WHERE e.ativo = 1
    ORDER BY e.nome
  `).all();
  res.json(rows);
});

// POST /api/nfe-distribuicao/sync
// Body: { empresa_id (opcional), competencia (opcional), reset_nsu: false }
// Se empresa_id não informado, sincroniza TODAS as empresas com certificado
router.post('/sync', auth(['admin']), async (req, res) => {
  const logs = [];

  try {
    const config = db.prepare('SELECT * FROM configuracoes LIMIT 1').get() || {};
    const pastaBase   = config.pasta_download_padrao || path.join(__dirname, '../../public/downloads');
    const competencia = req.body?.competencia || config.competencia_ativa || new Date().toISOString().slice(0, 7);
    const resetNSU    = req.body?.reset_nsu === true;
    const empresaIdFiltro = req.body?.empresa_id || null;

    logs.push(`Competência alvo: ${competencia}`);
    logs.push(`Pasta de destino: ${pastaBase}`);

    // Busca empresas com certificado cadastrado
    const query = empresaIdFiltro
      ? `SELECT e.id, e.nome, e.cnpj FROM empresas e
         JOIN certificados_digital c ON c.empresa_id = e.id
         WHERE e.id = ? AND e.ativo = 1`
      : `SELECT e.id, e.nome, e.cnpj FROM empresas e
         JOIN certificados_digital c ON c.empresa_id = e.id
         WHERE e.ativo = 1 ORDER BY e.nome`;

    const empresas = empresaIdFiltro
      ? db.prepare(query).all(empresaIdFiltro)
      : db.prepare(query).all();

    if (empresas.length === 0) {
      return res.json({ sucesso: false, mensagem: 'Nenhuma empresa com certificado cadastrado.', detalhes: logs });
    }

    logs.push(`Empresas a sincronizar: ${empresas.length}`);

    let totalBaixados = 0;
    let totalErros    = 0;

    for (const empresa of empresas) {
      const cnpjLimpo = empresa.cnpj.replace(/\D/g, '');
      const cert = getCertificado(cnpjLimpo);

      if (!cert) {
        logs.push(`⚠️  ${empresa.nome} — certificado não encontrado, pulando.`);
        continue;
      }

      // Busca NSU atual da empresa
      const nsuRow = db.prepare('SELECT ult_nsu FROM nfe_distribuicao_nsu WHERE empresa_id = ?').get(empresa.id);
      let ultNSU = (resetNSU || !nsuRow) ? 0 : (nsuRow.ult_nsu || 0);

      logs.push(`🏢 ${empresa.nome} — consultando a partir do NSU ${ultNSU}...`);

      let baixadosEmpresa = 0;
      let continuar = true;
      let tentativas = 0;

      while (continuar && tentativas < 100) {
        tentativas++;
        try {
          const resultado = await consultarDistribuicao(cnpjLimpo, ultNSU, cert.pfxBuffer, cert.senha);

          if (resultado.docs.length === 0) {
            logs.push(`  ℹ️  Sem documentos novos (cStat ${resultado.cStat})`);
            continuar = false;
          } else {
            for (const doc of resultado.docs) {
              // Filtra por competência se o XML tiver dhEmi
              const dhEmiMatch = doc.xml.match(/<dhEmi>([^<]+)<\/dhEmi>/);
              if (dhEmiMatch) {
                const dhEmi = dhEmiMatch[1].substring(0, 7); // YYYY-MM
                if (dhEmi !== competencia) continue;
              }

              // Determina o tipo pelo schema
              const tipo = doc.schema.startsWith('resNFe') ? 'resumo' :
                           doc.schema.includes('procNFe') ? 'NFe' :
                           doc.schema.includes('procCTe') ? 'CTe' : 'doc';

              // Extrai chave do XML
              const chaveMatch = doc.xml.match(/Id="NFe(\d{44})"/) ||
                                 doc.xml.match(/Id="CTe(\d{44})"/) ||
                                 doc.xml.match(/<chNFe>(\d{44})<\/chNFe>/) ||
                                 doc.xml.match(/<chCTe>(\d{44})<\/chCTe>/);

              const nomeArquivo = chaveMatch
                ? `${chaveMatch[1]}.xml`
                : `NSU_${doc.nsu}.xml`;

              // Salva na pasta organizada por competência/CNPJ
              const baseDir = path.join(pastaBase, 'fiscal', competencia, cnpjLimpo);
              if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

              const xmlPath = path.join(baseDir, nomeArquivo);
              if (!fs.existsSync(xmlPath)) {
                fs.writeFileSync(xmlPath, doc.xml, 'utf-8');
                baixadosEmpresa++;
                totalBaixados++;
              }
            }

            // Atualiza NSU
            ultNSU = resultado.ultNSU;
            continuar = resultado.temMais;

            logs.push(`  ✅ Lote processado: ${resultado.docs.length} docs, NSU atual: ${ultNSU}`);
          }

          // Pausa entre lotes para não sobrecarregar
          if (continuar) await new Promise(r => setTimeout(r, 1000));

        } catch (err) {
          logs.push(`  ❌ Erro na consulta: ${err.message}`);
          totalErros++;
          continuar = false;
        }
      }

      // Persiste NSU atualizado
      db.prepare(`
        INSERT OR REPLACE INTO nfe_distribuicao_nsu (empresa_id, ult_nsu, ultima_sync)
        VALUES (?, ?, datetime('now', 'localtime'))
      `).run(empresa.id, ultNSU);

      logs.push(`  💾 ${empresa.nome} — ${baixadosEmpresa} XMLs salvos. NSU salvo: ${ultNSU}`);
    }

    logs.push(`──────────────────────────────────`);
    logs.push(`Total: ${totalBaixados} XMLs baixados | ${totalErros} erros`);

    res.json({
      sucesso: true,
      mensagem: `Distribuição concluída. ${totalBaixados} XMLs baixados.`,
      detalhes: logs
    });

  } catch (error) {
    console.error('[NFeDistribuicao Error]', error);
    res.status(500).json({ erro: 'Falha: ' + error.message });
  }
});

// POST /api/nfe-distribuicao/reset-nsu/:empresaId
// Zera o NSU de uma empresa para reprocessar tudo
router.post('/reset-nsu/:id', auth(['admin']), (req, res) => {
  db.prepare(`
    INSERT OR REPLACE INTO nfe_distribuicao_nsu (empresa_id, ult_nsu, ultima_sync)
    VALUES (?, 0, NULL)
  `).run(req.params.id);
  res.json({ mensagem: 'NSU zerado. Próxima sync buscará todos os documentos.' });
});

module.exports = router;
