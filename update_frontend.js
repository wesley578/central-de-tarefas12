const fs = require('fs');

// 1. Atualizar HTML
let html = fs.readFileSync('public/index.html', 'utf8');

const execTbl = `<table class="dtbl" id="exec-tbl">
            <thead><tr><th>Empresa</th><th>Tarefa</th><th>Categoria</th><th>Status</th><th>O que foi feito</th><th>Quando</th><th>Responsável</th><th></th></tr></thead>
            <tbody></tbody>
          </table>
        </div>`;
const execTblNew = execTbl + `\n        <div style="padding:14px;border-top:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between;font-size:12px">
          <span style="color:var(--mt)" id="exec-page-info">Página 1</span>
          <div style="display:flex;gap:6px">
            <button class="btn btn-g btn-sm" onclick="changeExecPage(-1)">Anterior</button>
            <button class="btn btn-g btn-sm" onclick="changeExecPage(1)">Próxima</button>
          </div>
        </div>`;
html = html.replace(execTbl, execTblNew);

const histTbl = `<table class="dtbl" id="hist-tbl">
            <thead><tr><th>Mês</th><th>Empresa</th><th>Tarefa</th><th>Categoria</th><th>Status</th><th>O que foi feito</th><th>Quando</th><th>Responsável</th><th></th></tr></thead>
            <tbody></tbody>
          </table>
        </div>`;
const histTblNew = histTbl + `\n        <div style="padding:14px;border-top:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between;font-size:12px">
          <span style="color:var(--mt)" id="hist-page-info">Página 1</span>
          <div style="display:flex;gap:6px">
            <button class="btn btn-g btn-sm" onclick="changeHistPage(-1)">Anterior</button>
            <button class="btn btn-g btn-sm" onclick="changeHistPage(1)">Próxima</button>
          </div>
        </div>`;
html = html.replace(histTbl, histTblNew);

html = html.replace(/onchange="loadExec\(\)"/g, 'onchange="execPage=1; loadExec()"');
html = html.replace(/onchange="loadHist\(\)"/g, 'onchange="histPage=1; loadHist()"');

fs.writeFileSync('public/index.html', html);


// 2. Atualizar JS
let js = fs.readFileSync('public/js/app.js', 'utf8');

// Add globals
js = js.replace('let charts = {};', 'let charts = {};\nlet execPage = 1;\nlet histPage = 1;\nlet execTotal = 0;\nlet histTotal = 0;\nconst PAGE_LIMIT = 50;');

// Exec functions
const oldLoadExec = `const rows=await api('/execucoes?'+p);
  document.querySelector('#exec-tbl tbody').innerHTML=rows.length
    ?rows.map(r=>\`<tr>`;

const newLoadExec = `p.set('page', execPage);
  p.set('limit', PAGE_LIMIT);
  const res=await api('/execucoes?'+p);
  const rows = res.data;
  execTotal = res.total;
  const totalPages = Math.ceil(execTotal / PAGE_LIMIT) || 1;
  document.getElementById('exec-page-info').textContent = \`Página \${execPage} de \${totalPages} (\${execTotal} registros)\`;
  document.querySelector('#exec-tbl tbody').innerHTML=rows.length
    ?rows.map(r=>\`<tr>`;

js = js.replace(oldLoadExec, newLoadExec);

js += `\nwindow.changeExecPage = function(dir) {
  const totalPages = Math.ceil(execTotal / PAGE_LIMIT) || 1;
  if (execPage + dir < 1 || execPage + dir > totalPages) return;
  execPage += dir;
  loadExec();
};\n`;


// Hist functions
const oldLoadHist = `const rows=await api('/historico?'+p);
  document.querySelector('#hist-tbl tbody').innerHTML=rows.length
    ?rows.map(r=>\`<tr>`;

const newLoadHist = `p.set('page', histPage);
  p.set('limit', PAGE_LIMIT);
  const res=await api('/historico?'+p);
  const rows = res.data;
  histTotal = res.total;
  const totalPages = Math.ceil(histTotal / PAGE_LIMIT) || 1;
  document.getElementById('hist-page-info').textContent = \`Página \${histPage} de \${totalPages} (\${histTotal} registros)\`;
  document.querySelector('#hist-tbl tbody').innerHTML=rows.length
    ?rows.map(r=>\`<tr>`;

js = js.replace(oldLoadHist, newLoadHist);

js += `\nwindow.changeHistPage = function(dir) {
  const totalPages = Math.ceil(histTotal / PAGE_LIMIT) || 1;
  if (histPage + dir < 1 || histPage + dir > totalPages) return;
  histPage += dir;
  loadHist();
};\n`;

// Fix missing execPage reset
js = js.replace("document.getElementById('fh-mes').value='${r.mes_referencia}';loadHist()", "document.getElementById('fh-mes').value='${r.mes_referencia}';histPage=1;loadHist()");

fs.writeFileSync('public/js/app.js', js);
