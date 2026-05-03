const puppeteer = require('puppeteer');
require('dotenv').config();

const LOGIN_URL = 'https://web.meudanfe.com.br/signin';
const NFE_URL   = 'https://web.meudanfe.com.br/signed/nfe/my';
const CTE_URL   = 'https://web.meudanfe.com.br/signed/cte/my';

async function extrairPaginaAtual(page) {
  return await page.evaluate(() => {
    const rows = document.querySelectorAll('.table-responsive table tbody tr');
    return Array.from(rows).map(row => {
      const cells = Array.from(row.querySelectorAll('td'));
      let chave = null;

      const rowAttr = row.getAttribute('data-chave') || row.getAttribute('data-key') || row.getAttribute('data-id');
      if (rowAttr && /^\d{44}$/.test(rowAttr.trim())) chave = rowAttr.trim();

      if (!chave) {
        for (const cell of cells) {
          const texto = cell.innerText.trim().replace(/\s+/g, '');
          if (/^\d{44}$/.test(texto)) { chave = texto; break; }
          for (const a of cell.querySelectorAll('a[href]')) {
            const m = (a.getAttribute('href') || '').match(/(\d{44})/);
            if (m) { chave = m[1]; break; }
          }
          if (chave) break;
          const ca = cell.getAttribute('data-chave') || cell.getAttribute('data-key');
          if (ca && /^\d{44}$/.test(ca.trim())) { chave = ca.trim(); break; }
        }
      }

      // Extrai data de emissão varrendo todas as células em busca de DD/MM/YYYY
      let dataEmissao = null;
      for (const cell of cells) {
        const txt = cell.innerText.trim();
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(txt)) { dataEmissao = txt; break; }
      }

      return chave ? { chave, dataEmissao } : null;
    }).filter(Boolean);
  });
}

async function lerTotalPaginas(page) {
  return await page.evaluate(() => {
    const texto = document.body.innerText || '';
    const m = texto.match(/Total\s+Paginas?\s*[:\-]\s*(\d+)/i);
    return m ? parseInt(m[1], 10) : 1;
  });
}

async function irParaPagina(page, numero) {
  return await page.evaluate((n) => {
    const links = Array.from(document.querySelectorAll('.pagination a, .page-link, nav a'));
    const alvo = links.find(a => a.innerText.trim() === String(n));
    if (alvo) { alvo.click(); return true; }
    const seletores = ['li.next:not(.disabled) a', '.pagination .next:not(.disabled) a', 'a[aria-label="Next"]', '.page-item:last-child:not(.disabled) .page-link'];
    for (const sel of seletores) {
      const btn = document.querySelector(sel);
      if (btn && !btn.closest('.disabled')) { btn.click(); return true; }
    }
    return false;
  }, numero);
}

async function aplicarFiltroEmpresa(page, valor) {
  try { await page.select('select', valor); } catch {
    await page.evaluate((v) => {
      const sel = document.querySelector('select');
      if (sel) { sel.value = v; sel.dispatchEvent(new Event('change')); }
    }, valor);
  }
  const clicou = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button, a.btn')).find(b => b.innerText.toLowerCase().includes('aplicar'));
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (clicou) {
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => new Promise(r => setTimeout(r, 3000)));
  }
}

async function extrairTodasAsPaginas(page, tipo) {
  const todos = [];
  await page.waitForSelector('.table-responsive table tbody', { timeout: 10000 }).catch(() => {});
  const totalPaginas = await lerTotalPaginas(page);
  console.log(`[Scraper]   Total de páginas: ${totalPaginas}`);

  const p1 = await extrairPaginaAtual(page);
  todos.push(...p1.map(i => ({ ...i, tipo })));
  console.log(`[Scraper]   Página 1: ${p1.length} registros`);

  for (let pagina = 2; pagina <= totalPaginas; pagina++) {
    const clicou = await irParaPagina(page, pagina);
    if (!clicou) { console.log(`[Scraper]   Não foi possível navegar para página ${pagina}.`); break; }
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => new Promise(r => setTimeout(r, 3000)));
    await page.waitForSelector('.table-responsive table tbody', { timeout: 10000 }).catch(() => {});
    const itens = await extrairPaginaAtual(page);
    todos.push(...itens.map(i => ({ ...i, tipo })));
    console.log(`[Scraper]   Página ${pagina}: ${itens.length} registros`);
  }
  return todos;
}

async function extrairChavesMeuDanfe() {
  const user = process.env.MEUDANFE_USER;
  const pass = process.env.MEUDANFE_PASS;
  if (!user || !pass) throw new Error('Credenciais MEUDANFE_USER ou MEUDANFE_PASS não configuradas no .env');

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    console.log('[Scraper] Fazendo login no MeuDANFE...');
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });
    await page.type('input[name="username"]', user);
    await page.type('input[name="password"]', pass);
    await page.click('a.btn-login');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    const todasAsChaves = [];

    for (const { url, tipo } of [{ url: NFE_URL, tipo: 'NFe' }, { url: CTE_URL, tipo: 'CTe' }]) {
      console.log(`[Scraper] Iniciando extração de ${tipo}...`);
      await page.goto(url, { waitUntil: 'networkidle2' });

      const empresas = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('select option'))
          .map(o => ({ value: o.value, text: o.innerText.trim() }))
          .filter(o => o.value && o.value !== '' && !o.text.toLowerCase().includes('toda'));
      });

      if (empresas.length === 0) {
        console.log(`[Scraper] Sem filtro de empresa — raspando tudo`);
        todasAsChaves.push(...await extrairTodasAsPaginas(page, tipo));
      } else {
        for (const empresa of empresas) {
          const cnpjMatch = empresa.text.match(/\(([^)]+)\)/);
          const cnpjEmpresa = cnpjMatch ? cnpjMatch[1].replace(/\D/g, '') : null;
          console.log(`[Scraper] Filtrando: ${empresa.text}`);
          await page.goto(url, { waitUntil: 'networkidle2' });
          await aplicarFiltroEmpresa(page, empresa.value);
          const itens = await extrairTodasAsPaginas(page, tipo);
          todasAsChaves.push(...itens.map(i => ({ ...i, cnpjDestinatario: cnpjEmpresa })));
        }
      }
    }

    console.log(`[Scraper] Total de chaves encontradas: ${todasAsChaves.length}`);
    return todasAsChaves;

  } catch (error) {
    console.error('[Scraper] Erro durante a extração:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

module.exports = { extrairChavesMeuDanfe };
