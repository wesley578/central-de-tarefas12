const fs = require('fs');

// 1. UPDATE SERVER.JS
let serverJs = fs.readFileSync('server.js', 'utf8');

// Schema & Migration
serverJs = serverJs.replace(
  "descricao TEXT,",
  "descricao TEXT,\n    dia_vencimento INTEGER,"
);

const migrationBlock = `// Migrations
try { db.prepare('ALTER TABLE tarefas ADD COLUMN dia_vencimento INTEGER').run(); } catch(e) {}
`;
serverJs = serverJs.replace(
  "// Migration: populate empresa_tarefas",
  migrationBlock + "\n// Migration: populate empresa_tarefas"
);

// Zod schema
serverJs = serverJs.replace(
  "const TarefaSchema = z.object({ nome: z.string().min(1, 'Nome obrigatório'), categoria: z.string().optional().nullable(), descricao: z.string().optional().nullable() });",
  "const TarefaSchema = z.object({ nome: z.string().min(1, 'Nome obrigatório'), categoria: z.string().optional().nullable(), descricao: z.string().optional().nullable(), dia_vencimento: z.number().min(1).max(31).optional().nullable() });"
);

// POST tarefas
serverJs = serverJs.replace(
  "const {nome,categoria,descricao}=parsed.data;\n  const tid=db.prepare('INSERT INTO tarefas (nome,categoria,descricao) VALUES(?,?,?)').run(nome,categoria||null,descricao||null).lastInsertRowid;",
  "const {nome,categoria,descricao,dia_vencimento}=parsed.data;\n  const tid=db.prepare('INSERT INTO tarefas (nome,categoria,descricao,dia_vencimento) VALUES(?,?,?,?)').run(nome,categoria||null,descricao||null,dia_vencimento||null).lastInsertRowid;"
);

// PUT tarefas
serverJs = serverJs.replace(
  "const {nome,categoria,descricao}=parsed.data;\n  db.prepare('UPDATE tarefas SET nome=COALESCE(?,nome),categoria=COALESCE(?,categoria),descricao=COALESCE(?,descricao) WHERE id=?').run(nome,categoria,descricao,req.params.id);",
  "const {nome,categoria,descricao,dia_vencimento}=parsed.data;\n  db.prepare('UPDATE tarefas SET nome=COALESCE(?,nome),categoria=COALESCE(?,categoria),descricao=COALESCE(?,descricao),dia_vencimento=COALESCE(?,dia_vencimento) WHERE id=?').run(nome,categoria,descricao,dia_vencimento,req.params.id);"
);

// GET notificacoes
const notificacoesEndpoint = `
// ── NOTIFICAÇÕES ──────────────────────────────────────────────────────────────
app.get('/api/notificacoes', (req, res) => {
  const today = new Date().getDate();
  const alerts = db.prepare(\`
    SELECT e.id, em.nome AS empresa_nome, t.nome AS tarefa_nome, t.dia_vencimento
    FROM execucoes e
    JOIN empresas em ON em.id = e.empresa_id
    JOIN tarefas t ON t.id = e.tarefa_id
    WHERE e.status != 'concluida' AND t.dia_vencimento IS NOT NULL AND t.dia_vencimento <= ?
    ORDER BY t.dia_vencimento ASC
  \`).all(today);
  res.json(alerts);
});
`;

serverJs = serverJs.replace("// ── DASHBOARD", notificacoesEndpoint + "\n// ── DASHBOARD");

fs.writeFileSync('server.js', serverJs);

// 2. UPDATE PUBLIC/INDEX.HTML
let html = fs.readFileSync('public/index.html', 'utf8');

// Topbar Bell
html = html.replace(
  '<div class="live">API conectada</div>',
  `<div style="margin-left:auto;display:flex;align-items:center;gap:16px">
      <div id="nav-bell" onclick="document.querySelector('[data-page=notificacoes]').click()" style="cursor:pointer;position:relative;color:var(--mt);transition:color .2s">
        <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
        <div id="bell-badge" style="display:none;position:absolute;top:-4px;right:-4px;background:var(--red);color:#fff;font-size:9px;font-weight:700;width:14px;height:14px;border-radius:50%;align-items:center;justify-content:center">0</div>
      </div>
      <div class="live">API conectada</div>
    </div>`
);

// Sidebar item
html = html.replace(
  '<div class="nav-item" data-page="configuracoes">',
  `<div class="nav-item" data-page="notificacoes">
      <svg class="nav-icon" fill="none" viewBox="0 0 16 16"><path d="M8 14A6 6 0 108 2a6 6 0 000 12zM8 4v4l2 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Notificações
    </div>
    <div class="nav-item" data-page="configuracoes">`
);

// Notificacoes page
const notifPage = `
    <!-- NOTIFICAÇÕES -->
    <div class="page" id="pg-notificacoes">
      <div class="ph">
        <div><div class="pt">Notificações</div><div class="ps">Avisos de prazos e atrasos</div></div>
        <button class="btn btn-g btn-sm" onclick="loadNotificacoes()">↻ Atualizar</button>
      </div>
      <div class="sec">
        <div class="sb" id="notif-list" style="display:flex;flex-direction:column;gap:10px"></div>
      </div>
    </div>
`;
html = html.replace('<!-- CONFIGURAÇÕES -->', notifPage + '\n    <!-- CONFIGURAÇÕES -->');

// Tarefas table columns
html = html.replace(
  '<th>Descrição</th><th style="text-align:right">Ações</th>',
  '<th>Vencimento (Dia)</th><th>Descrição</th><th style="text-align:right">Ações</th>'
);

fs.writeFileSync('public/index.html', html);


// 3. UPDATE PUBLIC/JS/APP.JS
let js = fs.readFileSync('public/js/app.js', 'utf8');

// Nav routing
js = js.replace(
  'configuracoes: () => {}',
  'configuracoes: () => {},\n      notificacoes: loadNotificacoes'
);

// Load tarefas
js = js.replace(
  '<td style="font-size:11px;color:var(--mt)">${t.descricao||\'—\'}</td>',
  '<td><span class="badge b-pe" style="font-family:\'JetBrains Mono\',monospace">${t.dia_vencimento?`Dia ${t.dia_vencimento.toString().padStart(2,\'0\')}`:\'Sem prazo\'}</span></td>\n        <td style="font-size:11px;color:var(--mt)">${t.descricao||\'—\'}</td>'
);
js = js.replace(
  'colspan="4" class="empty"',
  'colspan="5" class="empty"'
);

// Modal tarefas
js = js.replace(
  '<div class="fg"><label>Descrição</label><input id="tf-desc" value="${t?.descricao||\'\'}" placeholder="Breve descrição"/></div>',
  '<div class="fg"><label>Descrição</label><input id="tf-desc" value="${t?.descricao||\'\'}" placeholder="Breve descrição"/></div>\n        <div class="fg"><label>Vencimento (Dia)</label><input type="number" id="tf-venc" value="${t?.dia_vencimento||\'\'}" min="1" max="31" placeholder="Ex: 20"/></div>'
);
js = js.replace('class="fg2"', 'class="fg3"'); // make it 3 columns

// Save tarefa
js = js.replace(
  "const descricao=document.getElementById('tf-desc').value.trim();",
  "const descricao=document.getElementById('tf-desc').value.trim();\n  let dia_vencimento=parseInt(document.getElementById('tf-venc').value); if(isNaN(dia_vencimento)) dia_vencimento=null;"
);
js = js.replace(
  "api(`/tarefas/${id}`,'PUT',{nome,categoria,descricao});",
  "api(`/tarefas/${id}`,'PUT',{nome,categoria,descricao,dia_vencimento});"
);
js = js.replace(
  "api('/tarefas','POST',{nome,categoria,descricao});",
  "api('/tarefas','POST',{nome,categoria,descricao,dia_vencimento});"
);

// Load notificacoes function
const loadNotifFn = `
async function loadNotificacoes() {
  try {
    const alerts = await api('/notificacoes');
    
    // Update badge
    const badge = document.getElementById('bell-badge');
    const bell = document.getElementById('nav-bell');
    if(alerts.length > 0) {
      badge.textContent = alerts.length > 99 ? '99+' : alerts.length;
      badge.style.display = 'flex';
      bell.style.color = 'var(--tx)';
    } else {
      badge.style.display = 'none';
      bell.style.color = 'var(--mt)';
    }

    const list = document.getElementById('notif-list');
    if(!list) return;

    if(alerts.length === 0) {
      list.innerHTML = '<div class="empty">Nenhuma tarefa atrasada no momento. Tudo em dia! 🎉</div>';
      return;
    }

    list.innerHTML = alerts.map(a => \`
      <div style="background:rgba(240,90,90,.08);border:1px solid rgba(240,90,90,.2);border-radius:8px;padding:12px 16px;display:flex;align-items:flex-start;gap:12px">
        <div style="font-size:20px">⚠️</div>
        <div>
          <div style="font-weight:600;font-size:13px;color:var(--red);margin-bottom:2px">Tarefa Atrasada</div>
          <div style="font-size:12px;color:var(--mt)">A tarefa <b>\${a.tarefa_nome}</b> da empresa <b>\${a.empresa_nome}</b> venceu no dia <b>\${a.dia_vencimento.toString().padStart(2,'0')}</b> e ainda está Pendente/Em Andamento.</div>
          <button class="btn btn-sm btn-g" style="margin-top:8px" onclick="goExec(\${a.empresa_id})">Ir para Execuções</button>
        </div>
      </div>
    \`).join('');
  } catch(e) {
    console.error(e);
  }
}
`;
js += '\n' + loadNotifFn;

// Call loadNotificacoes on init
js = js.replace(
  'loadDash();',
  'loadDash();\n  loadNotificacoes();'
);

fs.writeFileSync('public/js/app.js', js);
