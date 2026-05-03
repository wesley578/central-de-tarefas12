const https = require('https');
const zlib  = require('zlib');

const ENDPOINT = 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';

// Monta envelope SOAP para NFeDistribuicaoDFe
function montarSOAP(cnpj, ultNSU) {
  const nsu = String(ultNSU).padStart(15, '0');
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <nfeDadosMsg>
        <distDFeInt versao="1.01" xmlns="http://www.portalfiscal.inf.br/nfe">
          <tpAmb>1</tpAmb>
          <cUFAutor>35</cUFAutor>
          <CNPJ>${cnpj}</CNPJ>
          <distNSU>
            <ultNSU>${nsu}</ultNSU>
          </distNSU>
        </distDFeInt>
      </nfeDadosMsg>
    </nfeDistDFeInteresse>
  </soap12:Body>
</soap12:Envelope>`;
}

// Descomprime gzip base64 ou retorna o texto direto
function descomprimirDoc(docZip) {
  try {
    const buf = Buffer.from(docZip, 'base64');
    return zlib.gunzipSync(buf).toString('utf-8');
  } catch {
    return Buffer.from(docZip, 'base64').toString('utf-8');
  }
}

// Parseia o retorno SOAP e extrai documentos
function parsearResposta(xml) {
  const cStatMatch  = xml.match(/<cStat>(\d+)<\/cStat>/);
  const xMotivoMatch = xml.match(/<xMotivo>([^<]+)<\/xMotivo>/);
  const ultNSUMatch = xml.match(/<ultNSU>(\d+)<\/ultNSU>/);
  const maxNSUMatch = xml.match(/<maxNSU>(\d+)<\/maxNSU>/);

  const cStat   = cStatMatch  ? cStatMatch[1]  : '???';
  const xMotivo = xMotivoMatch ? xMotivoMatch[1] : 'Erro desconhecido';
  const ultNSU  = ultNSUMatch  ? parseInt(ultNSUMatch[1])  : 0;
  const maxNSU  = maxNSUMatch  ? parseInt(maxNSUMatch[1])  : 0;

  // cStat 137 = retornou documentos, 138 = sem documentos novos
  const sucesso = ['137', '138'].includes(cStat);

  // Extrai lote de documentos <docZip NSU="..." schema="...">...</docZip>
  const docs = [];
  const docRegex = /<docZip\s+NSU="(\d+)"\s+schema="([^"]+)"[^>]*>([^<]+)<\/docZip>/g;
  let m;
  while ((m = docRegex.exec(xml)) !== null) {
    docs.push({
      nsu:    parseInt(m[1]),
      schema: m[2],
      xml:    descomprimirDoc(m[3])
    });
  }

  return { sucesso, cStat, xMotivo, ultNSU, maxNSU, docs, temMais: ultNSU < maxNSU };
}

// Consulta NFeDistribuicaoDFe para um CNPJ a partir de um NSU
async function consultarDistribuicao(cnpj, ultNSU, pfxBuffer, pfxSenha) {
  const soap = montarSOAP(cnpj, ultNSU);
  const url  = new URL(ENDPOINT);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: 443,
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
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
        }
        try {
          const resultado = parsearResposta(data);
          if (!resultado.sucesso) {
            return reject(new Error(`SEFAZ cStat ${resultado.cStat}: ${resultado.xMotivo}`));
          }
          resolve(resultado);
        } catch(e) {
          reject(new Error(`Erro ao parsear resposta: ${e.message}`));
        }
      });
    });

    req.on('error', err => reject(new Error(`Conexão: ${err.message}`)));
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout (60s)')); });
    req.write(soap, 'utf8');
    req.end();
  });
}

module.exports = { consultarDistribuicao };
