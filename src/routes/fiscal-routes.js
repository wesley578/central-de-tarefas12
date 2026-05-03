const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const db      = require('../db');
const { auth } = require('../middleware/auth');
const { extrairChavesMeuDanfe }      = require('../services/meudanfeScraper');
const { baixarXmlMeuDanfe }          = require('../services/meudanfeService');

// Converte "DD/MM/YYYY" → "YYYY-MM"
function dataParaCompetencia(dataStr) {
  if (!dataStr) return null;
  const partes = dataStr.split('/');
  if (partes.length < 3) return null;
  return `${partes[2]}-${partes[1].padStart(2, '0')}`;
}

// POST /api/fiscal/meudanfe/sync
router.post('/meudanfe/sync', auth(['admin']), async (req, res) => {
  try {
    const logs = [];
    logs.push('Iniciando sincronização com MeuDANFE...');

    // 1. Configurações
    const config = db.prepare('SELECT * FROM configuracoes LIMIT 1').get() || {};
    const pastaBase   = config.pasta_download_padrao || path.join(__dirname, '../../public/downloads');
    // Usa competência do body se informada, senão usa a ativa no sistema
    const competencia = req.body?.competencia || config.competencia_ativa || new Date().toISOString().slice(0, 7);

    logs.push(`Competência alvo: ${competencia}`);
    logs.push(`Pasta de destino: ${pastaBase}`);

    // 2. Scraping
    const registros = await extrairChavesMeuDanfe();
    logs.push(`Encontradas ${registros.length} chaves no painel.`);

    // 3. Filtra apenas notas da competência ativa
    const doPeriodo = registros.filter(item => {
      const comp = dataParaCompetencia(item.dataEmissao);
      return comp === competencia;
    });

    logs.push(`Notas do período ${competencia}: ${doPeriodo.length}`);

    let baixados   = 0;
    let semEmpresa = 0;
    let erros      = 0;

    for (const item of doPeriodo) {
      const { chave, cnpjDestinatario, tipo } = item;
      const cnpjLimpo = cnpjDestinatario ? String(cnpjDestinatario).replace(/\D/g, '') : null;

      if (!cnpjLimpo) {
        logs.push(`⚠️  Chave sem CNPJ, pulando: ${chave}`);
        semEmpresa++;
        continue;
      }

      try {
        // 4. Cria pasta e baixa XML independentemente de ter execução
        const baseDir = path.join(pastaBase, 'fiscal', competencia, cnpjLimpo);
        if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

        const xml = await baixarXmlMeuDanfe(chave);
        const xmlPath = path.join(baseDir, xml.nomeArquivo);

        // Não sobrescreve se já existir
        if (fs.existsSync(xmlPath)) {
          logs.push(`⏭️  Já existe: ${xml.nomeArquivo}`);
          continue;
        }

        fs.writeFileSync(xmlPath, Buffer.from(xml.xmlBase64, 'base64'));
        baixados++;

        // Busca nome da empresa para o log (opcional)
        const empresa = db.prepare(`
          SELECT nome FROM empresas
          WHERE replace(replace(replace(cnpj, '.', ''), '/', ''), '-', '') = ?
        `).get(cnpjLimpo);

        const nomeLabel = empresa ? empresa.nome : `CNPJ ${cnpjLimpo}`;
        logs.push(`💾 ${nomeLabel} — ${tipo} salvo`);

      } catch (err) {
        erros++;
        logs.push(`❌ Erro ao baixar ${chave}: ${err.message}`);
      }
    }

    logs.push(`──────────────────────────────────`);
    logs.push(`Período: ${competencia} | Baixados: ${baixados} | Erros: ${erros}`);

    res.json({
      sucesso: true,
      mensagem: `Sincronização concluída. ${baixados} XMLs baixados.`,
      detalhes: logs
    });

  } catch (error) {
    console.error('[Fiscal Sync Error]', error);
    res.status(500).json({ erro: 'Falha na sincronização: ' + error.message });
  }
});

module.exports = router;
