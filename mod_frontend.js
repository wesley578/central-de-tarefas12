const fs = require('fs');

let html = fs.readFileSync('public/index.html', 'utf8');

// 1. ADD CHART.JS SCRIPT
if (!html.includes('chart.js')) {
  html = html.replace('</head>', '  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>\n</head>');
}

// 2. CSS HIDDEN CLASS
if (!html.includes('.hidden { display: none !important; }')) {
  html = html.replace('</style>', '  .hidden { display: none !important; }\n</style>');
}

// 3. ADD LOGIN PAGE
const loginPage = `
    <!-- LOGIN -->
    <div class="page" id="pg-login" style="display:flex;align-items:center;justify-content:center;height:100vh;background:var(--bg)">
      <div class="modal" style="display:block;position:relative;background:var(--panel);width:100%;max-width:360px;padding:32px">
        <div style="font-size:24px;font-weight:700;margin-bottom:8px;color:var(--tx)">Central de Tarefas</div>
        <div style="font-size:14px;color:var(--mt);margin-bottom:24px">Faça login para continuar</div>
        <div class="fg">
          <label>E-mail</label>
          <input type="email" id="login-email" placeholder="admin@admin.com"/>
        </div>
        <div class="fg">
          <label>Senha</label>
          <input type="password" id="login-senha" placeholder="••••••"/>
        </div>
        <button class="btn btn-p" style="width:100%;justify-content:center;margin-top:16px" onclick="doLogin()">Entrar</button>
      </div>
    </div>
`;
if (!html.includes('id="pg-login"')) {
  html = html.replace('<body>', '<body>\n' + loginPage);
}

// 4. ADD ADMIN-ONLY ATTRIBUTES TO NAV
html = html.replace('<div class="nav-item" data-page="empresas">', '<div class="nav-item admin-only" data-page="empresas">');
html = html.replace('<div class="nav-item" data-page="tarefas">', '<div class="nav-item admin-only" data-page="tarefas">');
html = html.replace('<div class="nav-item" data-page="configuracoes">', '<div class="nav-item admin-only" data-page="configuracoes">');
html = html.replace('<button class="btn btn-warn btn-sm" onclick="openFecharMes()">📦 Fechar mês</button>', '<button class="btn btn-warn btn-sm admin-only" onclick="openFecharMes()">📦 Fechar mês</button>');

// 5. DASHBOARD SLA CHART
const slaPanel = `
        <div style="background:var(--panel);border:1px solid var(--bdr);border-radius:12px;padding:20px;flex:1">
          <div style="font-size:12px;color:var(--mt);font-weight:500;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">SLA de Prazo (Mês Corrente)</div>
          <div style="display:flex;align-items:center;gap:16px">
            <div style="width:100px;height:100px"><canvas id="sla-chart"></canvas></div>
            <div>
              <div style="font-size:24px;font-weight:700;color:var(--tx)" id="sla-pct">--%</div>
              <div style="font-size:13px;color:var(--green)">Entregues no prazo</div>
              <div style="font-size:12px;color:var(--red);margin-top:4px" id="sla-atrasadas">0 atrasadas</div>
            </div>
          </div>
        </div>
`;
if (!html.includes('id="sla-chart"')) {
  html = html.replace('<div class="dash-grid" id="dg-cards"></div>', '<div class="dash-grid" id="dg-cards"></div>\n      <div style="display:flex;gap:16px;margin-bottom:24px">\n' + slaPanel + '\n      </div>');
}

// 6. EXECUCAO MODAL FILE INPUT
const fileInput = `
        <div class="fg">
          <label>Comprovante / Anexo (Opcional)</label>
          <input type="file" id="ex-file" accept=".pdf,.png,.jpg,.jpeg"/>
          <div id="ex-file-link" style="margin-top:8px;font-size:12px"></div>
        </div>
`;
if (!html.includes('id="ex-file"')) {
  html = html.replace('<div class="fg"><label>O que foi feito?</label>', fileInput + '\n        <div class="fg"><label>O que foi feito?</label>');
}

// 7. EXECUCOES & HISTORICO TABLE COLUMNS
if (!html.includes('<th>Anexo</th>')) {
  html = html.replace('<th>Responsável</th><th></th></tr></thead>', '<th>Responsável</th><th>Anexo</th><th></th></tr></thead>'); // execucoes
  html = html.replace('<th>Responsável</th><th></th></tr></thead>', '<th>Responsável</th><th>Anexo</th><th></th></tr></thead>'); // historico
}

// 8. LOGOUT BUTTON
if (!html.includes('doLogout()')) {
  html = html.replace('<div class="live">API conectada</div>', '<div class="live" style="cursor:pointer" onclick="doLogout()">Sair</div>');
}

fs.writeFileSync('public/index.html', html);


// ==========================================
// UPDATE JS
// ==========================================
let js = fs.readFileSync('public/js/app.js', 'utf8');

if (!js.includes('let currentUser = null;')) {
  // 1. GLOBAL USER
  js = js.replace('let charts = {};', 'let charts = {};\nlet currentUser = null;\nlet slaChartObj = null;');

  // 2. MODULAR API FUNCTION
  let apiJs = fs.readFileSync('public/js/api.js', 'utf8');
  apiJs = apiJs.replace(
    "async function api(path, method='GET', body=null) {",
    "async function api(path, method='GET', body=null, isFormData=false) {\n  const headers = {};\n  if (!isFormData) headers['Content-Type'] = 'application/json';\n  const token = localStorage.getItem('token');\n  if (token) headers['Authorization'] = 'Bearer ' + token;"
  );
  apiJs = apiJs.replace(
    "const opts = { method, headers: {'Content-Type':'application/json'} };",
    "const opts = { method, headers };"
  );
  apiJs = apiJs.replace(
    "if(body) opts.body = JSON.stringify(body);",
    "if(body) opts.body = isFormData ? body : JSON.stringify(body);"
  );
  apiJs = apiJs.replace(
    "if (!res.ok) throw new Error(data.erro || 'Erro na requisição');",
    "if (res.status===401||res.status===403) { localStorage.removeItem('token'); window.location.reload(); }\n    if (!res.ok) throw new Error(data.erro || 'Erro na requisição');"
  );
  fs.writeFileSync('public/js/api.js', apiJs);

  // 3. AUTH LOGIC IN APP.JS
  const authLogic = `
async function doLogin() {
  const email = document.getElementById('login-email').value;
  const senha = document.getElementById('login-senha').value;
  try {
    const res = await api('/auth/login', 'POST', {email, senha});
    localStorage.setItem('token', res.token);
    window.location.reload();
  } catch(e) { alert(e.message); }
}

function doLogout() {
  localStorage.removeItem('token');
  window.location.reload();
}
`;
  js += '\n' + authLogic;

  // 4. INITIALIZATION
  js = js.replace(
    'window.onload = () => {',
    "window.onload = async () => {\n  const token = localStorage.getItem('token');\n  if (!token) {\n    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));\n    document.getElementById('pg-login').classList.add('active');\n    document.querySelector('.sidebar').style.display = 'none';\n    return;\n  }\n  try {\n    currentUser = await api('/auth/me');\n    if (currentUser.role !== 'admin') {\n      document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));\n    }\n  } catch(e) { return; }\n"
  );

  js = js.replace(
    "if(p==='configuracoes') loadConfig();",
    "if(currentUser?.role !== 'admin' && ['empresas','tarefas','configuracoes'].includes(p)) return;\n      if(p==='configuracoes') loadConfig();"
  );

  js = js.replace("nav('dashboard');", "document.getElementById('pg-login').classList.remove('active');\n    document.querySelector('.sidebar').style.display = 'flex';\n    nav('dashboard');");

  // 5. RENDER ANEXO COLUMNS
  js = js.replace(
    '<td style="white-space:nowrap;font-size:12px;color:var(--mt)">${r.responsavel||\'\'}</td>',
    '<td style="white-space:nowrap;font-size:12px;color:var(--mt)">${r.responsavel||\'\'}</td>\n        <td>${r.comprovante ? `<a href="/uploads/${r.comprovante}" target="_blank" style="color:var(--blue)">📎 Ver</a>` : \'\'}</td>'
  );
  js = js.replace('colspan="8"', 'colspan="9"');

  js = js.replace(
    '<td style="white-space:nowrap;font-size:12px;color:var(--mt)">${r.responsavel||\'\'}</td>',
    '<td style="white-space:nowrap;font-size:12px;color:var(--mt)">${r.responsavel||\'\'}</td>\n        <td>${r.comprovante ? `<a href="/uploads/${r.comprovante}" target="_blank" style="color:var(--blue)">📎 Ver</a>` : \'\'}</td>'
  );
  js = js.replace('colspan="9"', 'colspan="10"'); 

  // 6. UPLOAD HANDLING
  const replace1 = "document.getElementById('ex-resp').value=r.responsavel||'';";
  const replace2 = "document.getElementById('ex-resp').value=r.responsavel||'';\n    document.getElementById('ex-file').value='';\n    document.getElementById('ex-file-link').innerHTML=r.comprovante ? `<a href=\"/uploads/${r.comprovante}\" target=\"_blank\" style=\"color:var(--blue)\">📎 Ver arquivo salvo</a>` : '';";
  js = js.replace(replace1, replace2);

  const saveStr = "await api(`/execucoes/${execOpenId}`,'PUT',{o_que_foi_feito,quando,observacoes,status,responsavel});";
  const saveNew = `await api(\`/execucoes/\${execOpenId}\`,'PUT',{o_que_foi_feito,quando,observacoes,status,responsavel});
    
    // Upload File
    const file = document.getElementById('ex-file').files[0];
    if(file) {
      const fd = new FormData();
      fd.append('comprovante', file);
      await api(\`/execucoes/\${execOpenId}/comprovante\`, 'POST', fd, true);
    }`;
  js = js.replace(saveStr, saveNew);

  // 7. DASHBOARD SLA CHART
  const loadSla = `
    const sla = await api('/dashboard/sla');
    document.getElementById('dg-cards').insertAdjacentHTML('beforebegin', '');
    const pctSla = sla.total > 0 ? Math.round((sla.no_prazo / sla.total)*100) : 0;
    document.getElementById('sla-pct').textContent = pctSla + '%';
    document.getElementById('sla-pct').style.color = pctSla >= 80 ? 'var(--green)' : 'var(--red)';
    document.getElementById('sla-atrasadas').textContent = sla.atrasadas + ' tarefas entregues com atraso';

    if(slaChartObj) slaChartObj.destroy();
    slaChartObj = new Chart(document.getElementById('sla-chart'), {
      type: 'doughnut',
      data: {
        labels: ['No Prazo', 'Atrasadas'],
        datasets: [{ data: [sla.no_prazo, sla.atrasadas], backgroundColor: ['#4ade80', '#f87171'], borderWidth: 0 }]
      },
      options: { cutout: '75%', plugins: { legend: { display: false } } }
    });
`;
  js = js.replace(
    "document.getElementById('dg-cards').innerHTML=`",
    loadSla + "\n    document.getElementById('dg-cards').innerHTML=`"
  );

  fs.writeFileSync('public/js/app.js', js);
}
