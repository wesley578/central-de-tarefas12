const https = require('https');

// Endpoints NFeConsultaProtocolo 4.00 produção
// Fonte: https://dfe-portal.svrs.rs.gov.br/Nfe/Servicos
const ENDPOINTS = {
  '13': 'https://nfe.sefaz.am.gov.br/services2/services/NfeConsulta4',              // AM
  '29': 'https://nfe.sefaz.ba.gov.br/webservices/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx', // BA
  '52': 'https://nfe.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4',           // GO
  '31': 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4',        // MG
  '50': 'https://nfe.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4',                    // MS
  '51': 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeConsulta4',       // MT
  '26': 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeConsultaProtocolo4',  // PE
  '41': 'https://nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4',        // PR
  '43': 'https://nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta2',                 // RS (próprio)
  '35': 'https://nfe.fazenda.sp.gov.br/ws/nfeconsulta2.asmx',                      // SP

  // SVAN — Ambiente Nacional (Receita Federal)
  'SVAN': 'https://www.nfe.fazenda.gov.br/NFeConsulta2/NFeConsulta2',

  // SVRS — Sefaz Virtual RS (endpoint v4 correto)
  'SVRS': 'https://nfe.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
};

// Estados que usam SVRS para consulta
const USA_SVRS = ['12','14','16','17','21','22','23','24','25','27','28','32','33','42','53'];
// Estados que usam SVAN
const USA_SVAN = ['11','15'];

function getEndpoint(cUF) {
  if (ENDPOINTS[cUF]) return ENDPOINTS[cUF];
  if (USA_SVRS.includes(cUF)) return ENDPOINTS['SVRS'];
  if (USA_SVAN.includes(cUF)) return ENDPOINTS['SVAN'];
  return ENDPOINTS['SVAN'];
}

function montarSOAP(chave) {
  const cUF = chave.substring(0, 2);
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Header>
    <nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4">
      <cUF>${cUF}</cUF>
      <versaoDados>4.00</versaoDados>
    </nfeCabecMsg>
  </soap12:Header>
  <soap12:Body>
    <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4">
      <consSitNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
        <tpAmb>1</tpAmb>
        <xServ>CONSULTAR</xServ>
        <chNFe>${chave}</chNFe>
      </consSitNFe>
    </nfeDadosMsg>
  </soap12:Body>
</soap12:Envelope>`;
}

function extrairXmlDaResposta(soapResponse) {
  const padroes = [
    /<nfeProc[\s\S]*?<\/nfeProc>/,
    /<cteProc[\s\S]*?<\/cteProc>/,
    /<retConsSitNFe[\s\S]*?<\/retConsSitNFe>/,
  ];
  for (const re of padroes) {
    const m = soapResponse.match(re);
    if (m) return m[0];
  }
  return null;
}

async function consultarChaveSefaz(chave, pfxBuffer, pfxSenha) {
  const cUF      = chave.substring(0, 2);
  const endpoint = getEndpoint(cUF);
  const soap     = montarSOAP(chave);
  const url      = new URL(endpoint);

  console.log(`[SEFAZ] cUF=${cUF} → ${endpoint}`);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      pfx: pfxBuffer,
      passphrase: pfxSenha,
      rejectUnauthorized: false,
      headers: {
        'Content-Type': 'application/soap+xml;charset=UTF-8',
        'SOAPAction': '',
        'Content-Length': Buffer.byteLength(soap, 'utf8'),
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        console.log(`[SEFAZ] HTTP ${res.statusCode} — início: ${data.substring(0, 300)}`);
        const xml = extrairXmlDaResposta(data);
        if (xml) {
          resolve({ sucesso: true, xml });
        } else {
          const cStat   = (data.match(/<cStat>(\d+)<\/cStat>/) || [])[1] || '???';
          const xMotivo = (data.match(/<xMotivo>([^<]+)<\/xMotivo>/) || [])[1] || 'Resposta não reconhecida';
          console.log(`[SEFAZ] Resposta completa: ${data.substring(0, 800)}`);
          reject(new Error(`SEFAZ cStat ${cStat}: ${xMotivo}`));
        }
      });
    });

    req.on('error', err => reject(new Error(`Conexão SEFAZ: ${err.message}`)));
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout SEFAZ (30s)')); });
    req.write(soap, 'utf8');
    req.end();
  });
}

module.exports = { consultarChaveSefaz };
