const fs = require('fs');

const html = fs.readFileSync('public/index.html', 'utf8');

const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
if (styleMatch) {
  fs.mkdirSync('public/css', {recursive: true});
  fs.writeFileSync('public/css/style.css', styleMatch[1].trim() + '\n');
}

const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (scriptMatch) {
  fs.mkdirSync('public/js', {recursive: true});
  const jsCode = scriptMatch[1].trim();
  
  const apiCode = `const API = '/api';
const api = async (url, method='GET', body) => {
  const r = await fetch(API+url, {method, headers:{'Content-Type':'application/json'}, body: body?JSON.stringify(body):undefined});
  if (!r.ok) throw await r.json();
  return r.json();
};
const toast = (msg, c='var(--green)') => {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.borderColor = c; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
};`;

  fs.writeFileSync('public/js/api.js', apiCode + '\n');

  let appCode = jsCode.replace(/const API = '\/api';/g, '');
  appCode = appCode.replace(/const api = async[\s\S]*?return r\.json\(\);\n};/g, '');
  appCode = appCode.replace(/const toast = \([\s\S]*?\}, 2600\);\n};/g, '');

  fs.writeFileSync('public/js/app.js', appCode.trim() + '\n');
}

const newHtml = html
  .replace(/<style>[\s\S]*?<\/style>/, '<link rel="stylesheet" href="/css/style.css"/>')
  .replace(/<script>[\s\S]*?<\/script>/, '<script src="/js/api.js"></script>\n<script src="/js/app.js"></script>');

fs.writeFileSync('public/index.html', newHtml);
