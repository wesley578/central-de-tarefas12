const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.goto('https://www.nfse.gov.br/EmissorNacional/Login?ReturnUrl=%2fEmissorNacional');
  await page.screenshot({ path: path.join(__dirname, 'login_debug.png') });
  console.log('Screenshot saved to login_debug.png');
  await browser.close();
})();
