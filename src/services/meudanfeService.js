const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
require('dotenv').config();

const API_BASE = 'https://api.meudanfe.com.br/v2';

async function baixarDaMeuDanfe(chave) {
  const apiKey = process.env.MEUDANFE_API_KEY;
  if (!apiKey) throw new Error('MEUDANFE_API_KEY não configurada no .env');

  console.log(`[MeuDANFE] Solicitando download do PDF: ${chave}`);
  
  const response = await fetch(`${API_BASE}/fd/get/da/${chave}`, {
    method: 'GET',
    headers: { 'Api-Key': apiKey }
  });

  const data = await response.json();
  
  if (data.status === true && data.documento_base64) {
    return {
      pdfBase64: data.documento_base64,
      nomeArquivo: `${chave}.pdf`
    };
  } else {
    console.error(`[MeuDANFE] Resposta da API (PDF):`, JSON.stringify(data));
    throw new Error(data.mensagem || 'Falha ao obter PDF do MeuDANFE');
  }
}

async function baixarXmlMeuDanfe(chave) {
  const apiKey = process.env.MEUDANFE_API_KEY;
  if (!apiKey) throw new Error('MEUDANFE_API_KEY não configurada no .env');

  console.log(`[MeuDANFE] Solicitando download do XML: ${chave}`);
  
  const response = await fetch(`${API_BASE}/fd/get/xml/${chave}`, {
    method: 'GET',
    headers: { 'Api-Key': apiKey }
  });

  const data = await response.json();

  // Formato 1: { status: true, documento_base64: '...' }
  if (data.status === true && data.documento_base64) {
    return {
      xmlBase64: data.documento_base64,
      nomeArquivo: `${chave}.xml`
    };
  }

  // Formato 2: { name: '...xml', data: '<?xml...' }
  if (data.data && data.data.startsWith('<?xml')) {
    const xmlBase64 = Buffer.from(data.data).toString('base64');
    const nomeArquivo = data.name || `${chave}.xml`;
    return { xmlBase64, nomeArquivo };
  }

  console.error(`[MeuDANFE] Resposta da API (XML) HTTP ${response.status}:`, JSON.stringify(data).slice(0, 300));
  throw new Error(data.mensagem || `Falha ao obter XML do MeuDANFE (HTTP ${response.status})`);
}

async function buscarPorChave(chave) {
  const apiKey = process.env.MEUDANFE_API_KEY;
  if (!apiKey) throw new Error('MEUDANFE_API_KEY não configurada no .env');

  console.log(`[MeuDANFE] Solicitando busca por chave na SEFAZ: ${chave}`);

  const response = await fetch(`${API_BASE}/fd/add/${chave}`, {
    method: 'PUT',
    headers: { 'Api-Key': apiKey }
  });

  return await response.json();
}

module.exports = {
  baixarDaMeuDanfe,
  baixarXmlMeuDanfe,
  buscarPorChave
};
