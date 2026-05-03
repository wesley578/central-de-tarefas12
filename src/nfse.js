/**
 * Módulo de Captura de NFS-e
 * Automação Puppeteer para o portal nfse.gov.br
 *
 * CORREÇÕES APLICADAS (v2):
 *  1. Login: CNPJ injetado via evaluate (evita duplicação por InputMask)
 *  2. Verificação de login falsa negativa corrigida
 *  3. waitForNavigation removido após Filtrar (portal usa AJAX)
 *     → substituído por waitForFunction que aguarda a tabela popular
 *  4. Template literals com ${} corrigidos (bug que quebrava cookie header e downloads)
 *  5. Timeout duplo de 2s removido na navegação
 *  6. readdirSync filtra apenas arquivos da sessão atual (evita mistura com capturas anteriores)
 *  7. Log de debug adicionado para facilitar manutenção futura
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');

const ALGORITHM = 'aes-256-cbc';

function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) throw new Error('ENCRYPTION_KEY inválida no .env — deve ter 64 caracteres hex.');
  return Buffer.from(key, 'hex');
}

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc += cipher.final('hex');
  return { encrypted: enc, iv: iv.toString('hex') };
}

function decrypt(encrypted, ivHex) {
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  let dec = decipher.update(encrypted, 'hex', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

/**
 * Formata CNPJ: 12345678000190 → 12.345.678/0001-90
 */
function formatCnpj(raw) {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 14) return raw;
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
}

/**
 * Cria arquivo ZIP a partir de uma lista de arquivos
 */
function zipFiles(files, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    files.forEach(f => archive.file(f.path, { name: f.name }));
    archive.finalize();
  });
}

/**
 * Captura NFS-e do portal nacional
 */
async function capturarNfse({ cnpj, senha, tipo_nota, tipo_captura, data_inicio, data_fim, zipar, downloadDir, pasta_fixa, empresa_nome }) {
  const cnpjFormatado = formatCnpj(cnpj);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1280, height: 800 }
  });

  const page = await browser.newPage();
  const result = { notas: [], total_notas: 0, valor_total: 0, arquivos: [], erro: null };

  // ── CONFIGURAÇÃO DE DIRETÓRIO ──────────────────────────────────────────────
  // Se houver pasta_fixa, já calcula o subdiretório estruturado para baixar direto lá
  if (pasta_fixa) {
    const folderName = empresa_nome || cnpj;
    const targetBase = path.isAbsolute(pasta_fixa) ? pasta_fixa : path.join(process.cwd(), pasta_fixa);
    // Cria estrutura: PastaBase / Empresa / prestadas | tomadas / DD-MM-AAAA
    downloadDir = path.join(targetBase, folderName, tipo_nota, data_inicio.replace(/\//g, '-'));
  }

  // Se ainda não houver diretório (ex: sem config), usa uma pasta temporária do projeto
  if (!downloadDir) {
    downloadDir = path.join(process.cwd(), 'public', 'uploads', 'temp_' + Date.now());
  }

  try {
    // ── 1. LOGIN ─────────────────────────────────────────────────────────────
    await page.goto('https://www.nfse.gov.br/EmissorNacional/Login?ReturnUrl=%2fEmissorNacional', {
      waitUntil: 'networkidle2', timeout: 30000
    });

    await page.waitForSelector('#Inscricao', { timeout: 15000 });

    // CORREÇÃO 1: Injeção via evaluate evita conflito com InputMask do portal
    // O método type() digitava sobre a máscara e causava duplicação de caracteres
    await page.evaluate((val) => {
      const el = document.querySelector('#Inscricao');
      if (!el) return;
      el.value = '';
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, cnpjFormatado);

    const senhaInput = await page.$('#Senha');
    if (!senhaInput) throw new Error('Campo de senha (#Senha) não encontrado.');
    await senhaInput.type(senha, { delay: 40 });

    // Clica em Entrar
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
      page.click('button[type="submit"]')
    ]);

    // CORREÇÃO 2: Verificação de login mais precisa
    // A verificação anterior capturava falsos positivos em URLs como "/Login/Sucesso"
    const currentUrl = page.url();
    if (currentUrl.includes('/Login?') || /\/Login\s*$/.test(currentUrl)) {
      const errorMsg = await page.$eval(
        '[class*="error" i], [class*="alert" i], [class*="invalid" i]',
        el => el.textContent.trim()
      ).catch(() => null);
      throw new Error(errorMsg || 'Falha no login — verifique usuário e senha no Cofre.');
    }

    console.log(`[NFS-e] Login realizado. URL atual: ${currentUrl}`);

    // ── 2. NAVEGAR PARA O TIPO DE NOTA ───────────────────────────────────────
    const urlConsulta = tipo_nota === 'prestadas'
      ? 'https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas'
      : 'https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas';

    console.log(`[NFS-e] Navegando para: ${urlConsulta}`);
    await page.goto(urlConsulta, { waitUntil: 'networkidle2', timeout: 30000 });
    // CORREÇÃO 5: Removido o setTimeout duplicado (era 2x 2000ms desnecessários)
    await new Promise(r => setTimeout(r, 2000));

    // ── 3. APLICAR FILTROS DE DATA ────────────────────────────────────────────
    // Formato esperado pelo portal: DD/MM/AAAA
    // Exemplo correto: '01/01/2026' — NÃO usar '2026-01-01'
    await page.evaluate((dIni, dFim) => {
      const iIni = document.querySelector('#datainicio');
      const iFim = document.querySelector('#datafim');
      if (iIni) {
        iIni.value = dIni;
        iIni.dispatchEvent(new Event('input', { bubbles: true }));
        iIni.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (iFim) {
        iFim.value = dFim;
        iFim.dispatchEvent(new Event('input', { bubbles: true }));
        iFim.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, data_inicio, data_fim);

    await new Promise(r => setTimeout(r, 1000));

    // Clica em Filtrar
    const btnFiltrar = await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('button.btn-primary'));
      return btns.find(b => b.textContent.includes('Filtrar'));
    });

    if (btnFiltrar.asElement()) {
      await btnFiltrar.asElement().click();

      // CORREÇÃO 3 (PRINCIPAL): Portal usa AJAX — não há navegação de página.
      // O waitForNavigation anterior expirava silenciosamente e o código seguia
      // com a tabela ainda vazia, resultando em lista vazia.
      // Agora aguardamos a tabela popular OU uma mensagem de sem resultados.
      await page.waitForFunction(() => {
        const rows = document.querySelectorAll('table tbody tr');
        const semResultado = document.querySelector(
          '[class*="empty" i], [class*="sem-resultado" i], td[colspan], .alert-info'
        );
        return rows.length > 0 || semResultado !== null;
      }, { timeout: 20000 }).catch(() => {
        console.warn('[NFS-e] Timeout aguardando tabela — continuando mesmo assim.');
      });

      await new Promise(r => setTimeout(r, 1500));
    } else {
      console.warn('[NFS-e] Botão "Filtrar" não encontrado na página.');
    }

    // ── DEBUG: Inspeciona o que o robô encontrou na tabela ────────────────────
    // Útil para diagnóstico. Pode ser removido em produção se não precisar mais.
    const htmlDebug = await page.evaluate(() => {
      const t = document.querySelector('table.table-striped, table tbody');
      return t ? t.outerHTML.slice(0, 800) : 'TABELA NÃO ENCONTRADA NA PÁGINA';
    });
    console.log('[NFS-e DEBUG TABELA]', htmlDebug);

    // ── 4. CAPTURAR DADOS ─────────────────────────────────────────────────────
    if (tipo_captura === 'lista') {
      const rows = await page.$$eval('table.table-striped tbody tr, table tbody tr', trs =>
        trs.map(tr => {
          const tds = Array.from(tr.querySelectorAll('td'));
          if (tds.length < 5) return null;

          const numero      = tds[0]?.textContent.trim() || '';
          const cnpjCpf     = tds[1]?.querySelector('.cnpj, .cpf')?.textContent.trim()
                              || tds[1]?.textContent.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2}/)?.[0]
                              || '';
          const nome        = tds[1]?.textContent.replace(cnpjCpf, '').replace(/^[\s-]+|[\s-]+$/g, '').trim() || '';
          const competencia = tds[2]?.textContent.trim() || '';
          const valorRaw    = tds[4]?.textContent.trim() || '0';
          const valor       = parseFloat(valorRaw.replace(/[^\d,]/g, '').replace(',', '.')) || 0;

          const img = tds[5]?.querySelector('img');
          const situacao = img?.getAttribute('title') || img?.getAttribute('alt') || 'Normal';

          return { numero, competencia, nome, cnpjCpf, valor, situacao };
        }).filter(r => r !== null && (r.nome || r.cnpjCpf))
      );

      result.notas = rows.map(r => ({
        numero: r.numero,
        data_emissao: r.competencia,
        tomador_prestador: r.nome,
        cnpj_cpf: r.cnpjCpf,
        valor: r.valor,
        status: r.situacao
      }));

      result.total_notas = result.notas.length;
      result.valor_total = result.notas.reduce((s, n) => s + n.valor, 0);

      console.log(`[NFS-e] Captura concluída: ${result.total_notas} nota(s) | Total: R$ ${result.valor_total.toFixed(2)}`);

    } else {
      // XML ou PDF — faz download via requisição direta (Sessão)
      if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

      const subPath = tipo_captura === 'xml' ? 'NFSe' : 'DANFSe';
      const ext = tipo_captura === 'xml' ? 'xml' : 'pdf';

      // Captura Cookies da Sessão
      const cookies = await page.cookies();
      // CORREÇÃO 4: Template literals corrigidos — os ${} anteriores geravam
      // strings literais "${c.name}=${c.value}" em vez dos valores reais,
      // corrompendo o header Cookie e causando erro 401/403 nos downloads.
      const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      const userAgent = await page.evaluate(() => navigator.userAgent);

      // Busca HREFs de download na tabela
      const downloadHrefs = await page.evaluate((sp) => {
        const links = Array.from(document.querySelectorAll(`a[href*="Download/${sp}"]`));
        return links.map(a => a.href);
      }, subPath);

      if (downloadHrefs.length === 0) {
        // Tenta abrir menus de ações para revelar os links
        const trs = await page.$$('table.table-striped tbody tr');
        for (const tr of trs) {
          const btn = await tr.$('.icone-trigger, [class*="trigger" i]');
          if (btn) {
            await btn.click();
            await new Promise(r => setTimeout(r, 500));
          }
        }
        const updatedHrefs = await page.evaluate((sp) => {
          return Array.from(document.querySelectorAll(`a[href*="Download/${sp}"]`)).map(a => a.href);
        }, subPath);
        downloadHrefs.push(...updatedHrefs);
      }

      const uniqueHrefs = [...new Set(downloadHrefs)];
      console.log(`[NFS-e] Links de download encontrados: ${uniqueHrefs.length}`);

      // Registra timestamp de início para filtrar apenas arquivos desta sessão
      const tsInicio = Date.now();

      for (let i = 0; i < uniqueHrefs.length; i++) {
        const href = uniqueHrefs[i];
        try {
          const nomeArq = `nota_${String(i + 1).padStart(3, '0')}.${ext}`;
          const dest = path.join(downloadDir, nomeArq);

          await new Promise((resolve, reject) => {
            const req = https.get(href, {
              headers: {
                'Cookie': cookieHeader,
                'User-Agent': userAgent,
                'Referer': page.url()
              }
            }, (res) => {
              if (res.statusCode !== 200) return reject(new Error(`Status ${res.statusCode}`));
              const stream = fs.createWriteStream(dest);
              res.pipe(stream);
              stream.on('finish', () => { stream.close(); resolve(); });
            });
            req.on('error', reject);
            req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
          });

          result.total_notas++;
          console.log(`[NFS-e] Download ${i + 1}/${uniqueHrefs.length}: ${nomeArq}`);
        } catch (e) {
          console.error(`[NFS-e] Erro no download ${i + 1}: ${e.message}`);
        }
      }

      // CORREÇÃO 6: Filtra apenas arquivos criados nesta sessão
      // A versão anterior pegava arquivos de capturas anteriores junto com os novos
      const filesInDir = fs.readdirSync(downloadDir)
        .filter(f => f.toLowerCase().endsWith(`.${ext}`))
        .filter(f => {
          const stat = fs.statSync(path.join(downloadDir, f));
          return stat.mtimeMs >= tsInicio;
        });

      const downloadedFiles = filesInDir.map(f => ({ path: path.join(downloadDir, f), name: f }));
      result.arquivos = downloadedFiles;

      if (zipar && downloadedFiles.length > 0) {
        const zipName = `nfse_${tipo_nota}_${data_inicio.replace(/\//g, '')}_${data_fim.replace(/\//g, '')}.zip`;
        const zipPath = path.join(downloadDir, zipName);
        await zipFiles(downloadedFiles, zipPath);
        result.zip = zipPath; 
        console.log(`[NFS-e] ZIP gerado: ${zipName} em ${downloadDir}`);
      }
    }

  } catch (err) {
    result.erro = err.message;
    console.error(`[NFS-e] ERRO: ${err.message}`);
  } finally {
    await browser.close();
  }

  return result;
}

module.exports = { encrypt, decrypt, capturarNfse, formatCnpj };
