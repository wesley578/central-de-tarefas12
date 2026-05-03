const CATS = ['Fiscal','Contábil','Dep. Pessoal','Obrigações Acessórias','Administrativo'];
const REGIMES = ['SIMPLES','MEI','PRESUMIDO','REAL','CEI'];
let charts = {};
let currentUser = null;
let slaChartObj = null;
let execPage = 1;
let histPage = 1;
let execTotal = 0;
let histTotal = 0;
const PAGE_LIMIT = 50;
const mTitle = document.getElementById('m-title');
const mBody = document.getElementById('m-body');
const mFoot = document.getElementById('m-foot');
const closeModal = () => document.getElementById('ov').classList.add('hide');
const openModal = () => document.getElementById('ov').classList.remove('hide');

// ─── Nav ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('on'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('on'));
    el.classList.add('on');
    const pg = el.dataset.page;
    document.getElementById('pg-'+pg).classList.add('on');
    ({
      dashboard: loadDash,
      matrix: loadMatrix,
      execucoes: () => { fillExecFilters(); loadExec(); },
      historico: loadHistPage,
      empresas: loadEmpresas,
      tarefas: loadTarefas,
      nfse: () => switchNfseTab('cofre'),
      nfe: () => {},
      sefaz: () => { loadCertificados(); initSefazForm(); },
      distribuicao: () => { loadDistribuicaoCerts(); loadDistribuicaoStatus(); initDistribuicaoForm(); },
      configuracoes: loadConfiguracoes,
      notificacoes: loadNotificacoes
    })[pg]?.();
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────


const pctColor = p => p>=75?'#22c77a':p>=40?'#f5b942':'#f05050';
const fdate = d => { if(!d) return '—'; try{return new Date(d+'T00:00:00').toLocaleDateString('pt-BR')}catch{return d} };
const fmes = m => { if(!m) return '—'; const [y,mo]=m.split('-'); const names=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']; return `${names[+mo-1]} ${y}`; };
function badge(s) {
  const m={concluida:['b-ok','Concluída'],em_andamento:['b-pr','Em andamento'],pendente:['b-pe','Pendente'],bloqueada:['b-bl','Bloqueada']};
  const[c,l]=m[s]||['b-pe',s]; return `<span class="badge ${c}">${l}</span>`;
}
function mkChart(id, type, labels, data, colors) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(document.getElementById(id), {
    type, data: {labels, datasets:[{data, backgroundColor:type==='bar'?colors.map(c=>c+'33'):colors.map(c=>c+'bb'), borderColor:colors, borderWidth:type==='bar'?0:2, borderRadius:type==='bar'?5:0, hoverOffset:5}]},
    options:{responsive:true, plugins:{legend:{labels:{color:'#5a6380',font:{size:11},boxWidth:10,padding:10}}},
      scales: type==='bar'?{x:{ticks:{color:'#5a6380',font:{size:10}},grid:{color:'rgba(128,128,128,.08)'}},y:{max:100,ticks:{color:'#5a6380',font:{size:10},callback:v=>v+'%'},grid:{color:'rgba(128,128,128,.08)'}}}:{}
    }
  });
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
async function loadDash() {
  const d = await api('/dashboard');
  const {resumo,porTarefa,porEmpresa,porCategoria,recentes} = d;

  document.getElementById('dash-cards').innerHTML = `
    <div class="card ca"><div class="cl">Progresso geral</div><div class="cv" style="color:${pctColor(resumo.percentualGeral)}">${resumo.percentualGeral}%</div><div class="cs">${resumo.totalConcluidas} de ${resumo.totalExecucoes} execuções</div></div>
    <div class="card"><div class="cl">Empresas ativas</div><div class="cv">${resumo.totalEmpresas}</div><div class="cs">clientes monitorados</div></div>
    <div class="card"><div class="cl">Tarefas cadastradas</div><div class="cv">${resumo.totalTarefas}</div><div class="cs">templates ativos</div></div>
    <div class="card cg"><div class="cl">Concluídas</div><div class="cv" style="color:var(--green)">${resumo.totalConcluidas}</div><div class="cs">no mês corrente</div></div>
  `;

  mkChart('c-cat','bar', porCategoria.map(c=>c.categoria?.slice(0,12)||'—'), porCategoria.map(c=>c.percentual), ['#4f7fff','#22d08a','#7b5ff5','#f5b942','#f05050']);
  const sm={concluida:0,em_andamento:0,pendente:0,bloqueada:0};
  porTarefa.forEach(t=>{sm.concluida+=t.concluidas;sm.em_andamento+=t.em_andamento;sm.pendente+=t.pendentes;sm.bloqueada+=t.bloqueadas;});
  mkChart('c-sta','doughnut',['Concluídas','Em andamento','Pendentes','Bloqueadas'],Object.values(sm),['#22d08a','#f5b942','#5a6380','#f05050']);

  document.getElementById('prog-list').innerHTML = porTarefa.map(t => {
    const p = t.percentual||0;
    return `<div class="pr">
      <div class="pi"><div class="pn" title="${t.nome}">${t.nome}</div><div class="pc">${t.categoria||'—'}</div></div>
      <div class="pw"><div class="pt2"><div class="pf" style="width:${p}%;background:${pctColor(p)}"></div></div>
      <div class="pm"><span>${t.concluidas}/${t.total} empresas</span><span>${t.em_andamento} andamento · ${t.pendentes} pendentes</span></div></div>
      <div class="pp" style="color:${pctColor(p)}">${p}%</div>
    </div>`;
  }).join('');

  document.getElementById('co-grid').innerHTML = porEmpresa.map(e => {
    const p = e.percentual||0;
    return `<div class="cc" onclick="goExec(${e.id})">
      <div class="cch"><div><div class="ccn">${e.nome}</div><div class="ccr">${e.regime||'—'}</div></div><div class="ccp" style="color:${pctColor(p)}">${p}%</div></div>
      <div class="ccb"><div class="ccbf" style="width:${p}%;background:${pctColor(p)}"></div></div>
      <div class="ccs"><span>✓ ${e.concluidas}</span><span>◉ ${e.em_andamento}</span><span>· ${e.pendentes}</span>${e.bloqueadas?`<span>✕ ${e.bloqueadas}</span>`:''}</div>
    </div>`;
  }).join('');

  document.querySelector('#recent-tbl tbody').innerHTML = recentes.length
    ? recentes.map(r=>`<tr><td><b>${r.empresa_nome}</b></td><td style="font-size:11px">${r.tarefa_nome}</td><td><span class="ctag">${r.categoria}</span></td><td>${badge(r.status)}</td><td style="font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.o_que_foi_feito||'—'}</td><td style="font-size:11px">${fdate(r.quando)}</td></tr>`).join('')
    : `<tr><td colspan="6" class="empty">Nenhuma atividade recente.</td></tr>`;
}

// --- MEUDANFE SYNC ---
async function syncMeuDanfe() {
  const btn = document.getElementById('btn-sync-meudanfe');
  const btn2 = document.getElementById('btn-nfe-sync');
  const logCont = document.getElementById('nfe-sync-logs');
  
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sincronizando...'; }
  if (btn2) { btn2.disabled = true; btn2.innerText = 'Sincronizando...'; }
  if (logCont) logCont.innerHTML = '<div>⏳ Iniciando extração do painel MeuDANFE...</div>';

  try {
    toast('🚀 Iniciando sincronização com MeuDANFE...', 'var(--p)');
    const res = await api('/fiscal/meudanfe/sync', 'POST');
    
    if (res.sucesso) {
      toast(`✅ Sucesso! ${res.mensagem}`, 'var(--green)');
      
      if (logCont && res.detalhes) {
        logCont.innerHTML = res.detalhes.map(l => `<div>${l}</div>`).join('');
      }

      loadDash();
      if (document.getElementById('pg-execucoes').classList.contains('on')) loadExec();
    } else {
      toast('⚠️ Falha na sincronização: ' + (res.erro || 'Erro desconhecido'), 'var(--yellow)');
      if (logCont) logCont.innerHTML += `<div style="color:var(--red)">❌ Erro: ${res.erro}</div>`;
    }
  } catch (e) {
    toast('❌ Erro: ' + (e.erro || e.message || 'Falha na conexão'), 'var(--red)');
    if (logCont) logCont.innerHTML += `<div style="color:var(--red)">❌ Erro Crítico: ${e.message}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
    if (btn2) { btn2.disabled = false; btn2.innerText = '🔗 Sincronizar Agora'; }
  }
}

// ─── MATRIX ───────────────────────────────────────────────────────────────────
async function loadMatrix() {
  const {empresas,tarefas,matrix} = await api('/dashboard/matrix');
  const grp={};
  tarefas.forEach(t=>(grp[t.categoria]=grp[t.categoria]||[]).push(t));
  const dmap={concluida:'d-ok',em_andamento:'d-pr',pendente:'d-pe',bloqueada:'d-bl',na:'d-na'};
  const dico={concluida:'✓',em_andamento:'◉',pendente:'·',bloqueada:'✕',na:'—'};
  let h=`<table class="mat"><thead><tr><th style="min-width:150px">Tarefa</th>`;
  empresas.forEach(e=>h+=`<th style="min-width:68px">${e.nome.split(' ').slice(0,2).join('<br>')}</th>`);
  h+='</tr></thead><tbody>';
  Object.entries(grp).forEach(([cat,ts])=>{
    h+=`<tr class="mat-cat"><td colspan="${empresas.length+1}">${cat}</td></tr>`;
    ts.forEach(t=>{
      h+=`<tr><td>${t.nome}</td>`;
      empresas.forEach(e=>{const s=matrix[`${e.id}_${t.id}`]||'na'; h+=`<td><div class="dot ${dmap[s]}" title="${s}">${dico[s]}</div></td>`;});
      h+='</tr>';
    });
  });
  h+='</tbody></table>';
  document.getElementById('mat-cont').innerHTML=h;
}

// ─── EXECUÇÕES ────────────────────────────────────────────────────────────────
async function fillExecFilters() {
  const es=await api('/empresas');
  const sel=document.getElementById('fe-emp');
  const cur=sel.value;
  sel.innerHTML='<option value="">Todas as empresas</option>'+es.map(e=>`<option value="${e.id}" ${cur==e.id?'selected':''}>${e.nome}</option>`).join('');
}

async function loadCompetencia() {
  try {
    const { competencia_ativa } = await api('/competencia');
    // Topbar badge
    const badge = document.getElementById('competencia-badge');
    if (badge) badge.textContent = `📅 ${fmes(competencia_ativa)}`;
    // Execucoes inline label
    const label = document.getElementById('competencia-label');
    if (label) label.textContent = fmes(competencia_ativa);
    // Execucoes input control
    const input = document.getElementById('competencia-input');
    if (input) input.value = competencia_ativa;
    // Configuracoes input
    const inputCfg = document.getElementById('competencia-input-cfg');
    if (inputCfg) inputCfg.value = competencia_ativa;
  } catch(e) {}
}

async function salvarCompetencia() {
  const val = document.getElementById('competencia-input').value;
  if (!val) return toast('Selecione uma competência','var(--red)');
  try {
    await api('/competencia', 'PUT', { competencia_ativa: val });
    toast(`✓ Competência alterada para ${fmes(val)}`);
    await loadCompetencia();
    loadNotificacoes();
  } catch(e) { toast(e.erro||'Erro ao salvar competência','var(--red)'); }
}

async function salvarCompetenciaCfg() {
  const val = document.getElementById('competencia-input-cfg').value;
  if (!val) return toast('Selecione uma competência','var(--red)');
  try {
    await api('/competencia', 'PUT', { competencia_ativa: val });
    toast(`✓ Competência alterada para ${fmes(val)}`);
    await loadCompetencia();
    loadNotificacoes();
  } catch(e) { toast(e.erro||'Erro ao salvar competência','var(--red)'); }
}

async function loadExec() {
  await loadCompetencia();
  const emp=document.getElementById('fe-emp').value;
  const sta=document.getElementById('fe-sta').value;
  const cat=document.getElementById('fe-cat').value;
  const p=new URLSearchParams();
  if(emp) p.set('empresa_id',emp);
  if(sta) p.set('status',sta);
  if(cat) p.set('categoria',cat);
  p.set('page', execPage);
  p.set('limit', PAGE_LIMIT);
  const res=await api('/execucoes?'+p);
  const rows = res.data;
  execTotal = res.total;
  const totalPages = Math.ceil(execTotal / PAGE_LIMIT) || 1;
  document.getElementById('exec-page-info').textContent = `Página ${execPage} de ${totalPages} (${execTotal} registros)`;
  document.querySelector('#exec-tbl tbody').innerHTML=rows.length
    ?rows.map(r=>`<tr>
      <td><b>${r.empresa_nome}</b></td>
      <td style="font-size:11px">${r.tarefa_nome}</td>
      <td><span class="ctag">${r.categoria}</span></td>
      <td>${badge(r.status)}</td>
      <td style="font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.o_que_foi_feito||'—'}</td>
      <td style="font-size:11px">${fdate(r.quando)}</td>
      <td style="font-size:11px">${r.responsavel||'—'}</td>
      <td style="text-align:right"><button class="btn btn-g btn-sm" onclick="openExecModal(${r.id})">Editar</button></td>
    </tr>`).join('')
    :`<tr><td colspan="10" class="empty">Nenhuma execução encontrada.</td></tr>`;
}
function goExec(eid) {
  document.querySelector('[data-page="execucoes"]').click();
  setTimeout(()=>{document.getElementById('fe-emp').value=eid;loadExec();},60);
}

// ─── HISTÓRICO ────────────────────────────────────────────────────────────────
async function loadHistPage() {
  const [meses, empresas, resumo] = await Promise.all([api('/historico/meses'), api('/empresas'), api('/historico/resumo')]);

  // Fill month filter
  const selMes=document.getElementById('fh-mes');
  const curMes=selMes.value;
  selMes.innerHTML='<option value="">Todos os meses</option>'+meses.map(m=>`<option value="${m}" ${curMes===m?'selected':''}>${fmes(m)}</option>`).join('');

  // Fill empresa filter
  const selEmp=document.getElementById('fh-emp');
  const curEmp=selEmp.value;
  selEmp.innerHTML='<option value="">Todas as empresas</option>'+empresas.map(e=>`<option value="${e.id}" ${curEmp==e.id?'selected':''}>${e.nome}</option>`).join('');

  // Summary cards
  document.getElementById('hist-resumo').innerHTML=resumo.slice(0,6).map(r=>`
    <div class="cc" onclick="document.getElementById('fh-mes').value='${r.mes_referencia}';histPage=1;loadHist()">
      <div class="cch"><div><div class="ccn">${fmes(r.mes_referencia)}</div><div class="ccr">${r.empresas} empresa${r.empresas!==1?'s':''} · ${r.total} tarefas</div></div>
        <div class="ccp" style="color:${pctColor(r.percentual)}">${r.percentual}%</div>
      </div>
      <div class="ccb"><div class="ccbf" style="width:${r.percentual}%;background:${pctColor(r.percentual)}"></div></div>
      <div class="ccs">
        <span>✓ ${r.concluidas}</span><span>· ${r.pendentes}</span>${r.bloqueadas?`<span>✕ ${r.bloqueadas}</span>`:''}
        <button class="btn btn-warn btn-sm" style="margin-left:auto" onclick="event.stopPropagation();reabrirMes('${r.mes_referencia}')">↩ Reabrir</button>
      </div>
    </div>
  `).join('');

  loadHist();
}
async function loadHist() {
  const mes=document.getElementById('fh-mes').value;
  const emp=document.getElementById('fh-emp').value;
  const sta=document.getElementById('fh-sta').value;
  const cat=document.getElementById('fh-cat').value;
  const p=new URLSearchParams();
  if(mes) p.set('mes_referencia',mes);
  if(emp) p.set('empresa_id',emp);
  if(sta) p.set('status',sta);
  if(cat) p.set('categoria',cat);
  p.set('page', histPage);
  p.set('limit', PAGE_LIMIT);
  const res=await api('/historico?'+p);
  const rows = res.data;
  histTotal = res.total;
  const totalPages = Math.ceil(histTotal / PAGE_LIMIT) || 1;
  document.getElementById('hist-page-info').textContent = `Página ${histPage} de ${totalPages} (${histTotal} registros)`;
  document.querySelector('#hist-tbl tbody').innerHTML=rows.length
    ?rows.map(r=>`<tr>
      <td style="font-family:'JetBrains Mono',monospace;font-size:11px">${fmes(r.mes_referencia)}</td>
      <td><b>${r.empresa_nome}</b></td>
      <td style="font-size:11px">${r.tarefa_nome}</td>
      <td><span class="ctag">${r.categoria||'—'}</span></td>
      <td>${badge(r.status||'pendente')}</td>
      <td style="font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.o_que_foi_feito||'—'}</td>
      <td style="font-size:11px">${fdate(r.quando)}</td>
      <td style="font-size:11px">${r.responsavel||'—'}</td>
      <td style="text-align:right"><button class="btn btn-g btn-sm" onclick="openHistModal(${r.id})">Editar</button></td>
    </tr>`).join('')
    :`<tr><td colspan="9" class="empty">${mes?`Nenhum registro em ${fmes(mes)}.`:'Nenhum histórico encontrado. Feche um mês para arquivar.'}</td></tr>`;
}

// ─── FECHAR MÊS ───────────────────────────────────────────────────────────────
function openFecharMes() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth()+1).padStart(2,'0');
  const defaultMes = `${y}-${m}`;
  document.getElementById('m-title').textContent = '📦 Fechar mês';
  document.getElementById('m-body').innerHTML = `
    <div style="background:rgba(245,185,66,.07);border:1px solid rgba(245,185,66,.2);border-radius:9px;padding:14px 16px;margin-bottom:16px;font-size:12px;color:var(--yellow)">
      ⚠️ Esta ação arquiva todas as execuções do mês no Histórico e reseta o mês corrente para pendente.
    </div>
    <div class="fg">
      <label>Mês de referência</label>
      <input type="month" id="fm-mes" value="${defaultMes}"/>
    </div>
    <div style="font-size:11px;color:var(--mt);margin-top:10px">O mês arquivado poderá ser editado no Histórico a qualquer momento.</div>
  `;
  document.getElementById('m-foot').innerHTML=`<button class="btn btn-g" onclick="closeModal()">Cancelar</button><button class="btn btn-warn" onclick="confirmarFecharMes()">Confirmar fechamento</button>`;
  document.getElementById('ov').classList.remove('hide');
}
async function confirmarFecharMes() {
  const mes = document.getElementById('fm-mes').value;
  if (!mes) return toast('Selecione o mês','var(--red)');
  try {
    const r = await api('/mes/fechar','POST',{mes_referencia:mes});
    closeModal();
    toast(`✓ ${fmes(mes)} arquivado! Competência avançada para ${fmes(r.competencia_ativa)}.`);
    loadDash();
    loadCompetencia();
    loadNotificacoes();
  } catch(e) {
    if (e.status === 409 || (e.erro && e.erro.includes('já foi fechado'))) {
      toast(`⚠️ ${e.erro}`, 'var(--yellow)');
    } else {
      toast(e.erro||'Erro ao fechar mês','var(--red)');
    }
  }
}

async function reabrirMes(mes_referencia) {
  if (!confirm(`Reabrir o mês ${fmes(mes_referencia)}?\n\nOs registros voltarão para Execuções e o mês será removido do Histórico.`)) return;
  try {
    const r = await api('/mes/reabrir','POST',{mes_referencia});
    toast(`↩ ${fmes(mes_referencia)} reaberto! Competência restaurada para ${fmes(r.competencia_ativa)}.`);
    loadHistPage();
    loadDash();
    loadCompetencia();
    loadNotificacoes();
  } catch(e) { toast(e.erro||'Erro ao reabrir mês','var(--red)'); }
}

// ─── EMPRESAS ─────────────────────────────────────────────────────────────────
async function loadEmpresas() {
  const rows = await api('/empresas');
  // Get task counts per company
  const etData = await Promise.all(rows.map(e => api(`/empresas/${e.id}`)));
  document.querySelector('#emp-tbl tbody').innerHTML = rows.length
    ? rows.map((e,i)=>{
        const hab = etData[i].tarefas?.filter(t=>t.habilitada).length||0;
        const total = etData[i].tarefas?.length||0;
        return `<tr>
          <td><b>${e.nome}</b></td>
          <td style="font-family:'JetBrains Mono',monospace;font-size:11px">${e.cnpj||'—'}</td>
          <td><span class="ctag">${e.regime||'—'}</span></td>
          <td style="font-size:11px"><span style="color:var(--green)">${hab}</span><span style="color:var(--mt)"> / ${total}</span> habilitadas</td>
          <td>${e.ativo?'<span class="badge b-ok">Ativa</span>':'<span class="badge b-pe">Inativa</span>'}</td>
          <td style="text-align:right;display:flex;gap:5px;justify-content:flex-end">
            <button class="btn btn-g btn-sm" onclick="openEmpresaModal(${e.id})">Editar</button>
            <button class="btn btn-d btn-sm" onclick="delEmpresa(${e.id},'${e.nome.replace(/'/g,"\\'")}')">Remover</button>
          </td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="6" class="empty">Nenhuma empresa cadastrada.</td></tr>`;
}

async function openEmpresaModal(id=null) {
  const allTarefas = await api('/tarefas');
  let empresa = null;
  if (id) empresa = await api(`/empresas/${id}`);

  const habSet = new Set(empresa?.tarefas?.filter(t=>t.habilitada).map(t=>t.id)||allTarefas.map(t=>t.id));
  const grp={};
  allTarefas.forEach(t=>(grp[t.categoria]=grp[t.categoria]||[]).push(t));

  document.getElementById('m-title').textContent = empresa ? 'Editar empresa' : 'Nova empresa';
  document.getElementById('m-body').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="fg3">
        <div class="fg"><label>Nome *</label><input id="ef-nome" value="${empresa?.nome||''}" placeholder="Razão Social"/></div>
        <div class="fg"><label>CNPJ / CPF</label><input id="ef-cnpj" value="${empresa?.cnpj||''}" placeholder="00.000.000/0001-00"/></div>
      </div>
      <div class="fg2">
        <div class="fg"><label>Regime tributário</label>
          <select id="ef-reg">${REGIMES.map(r=>`<option ${empresa?.regime===r?'selected':''}>${r}</option>`).join('')}<option ${!empresa?.regime?'selected':''} value="">Não informado</option></select>
        </div>
        <div class="fg"><label>Status</label>
          <select id="ef-ativo"><option value="1" ${empresa?.ativo!==0?'selected':''}>Ativa</option><option value="0" ${empresa?.ativo===0?'selected':''}>Inativa</option></select>
        </div>
      </div>
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-size:12px;font-weight:500">Tarefas habilitadas</div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-g btn-sm" onclick="toggleAllTasks(true)">Marcar todas</button>
            <button class="btn btn-g btn-sm" onclick="toggleAllTasks(false)">Desmarcar</button>
          </div>
        </div>
        <div class="task-grid" id="task-grid">
          ${Object.entries(grp).map(([cat,ts])=>`
            <div class="task-cat-hdr">${cat}</div>
            ${ts.map(t=>`
              <label class="task-item">
                <input type="checkbox" class="task-cb" data-id="${t.id}" ${habSet.has(t.id)?'checked':''}/>
                <div class="task-item-info">
                  <div class="task-item-name">${t.nome}</div>
                </div>
              </label>
            `).join('')}
          `).join('')}
        </div>
      </div>
    </div>
  `;
  document.getElementById('m-foot').innerHTML=`<button class="btn btn-g" onclick="closeModal()">Cancelar</button><button class="btn btn-p" onclick="saveEmpresa(${id||'null'})">Salvar</button>`;
  document.getElementById('ov').classList.remove('hide');
}

function toggleAllTasks(checked) {
  document.querySelectorAll('.task-cb').forEach(cb => cb.checked = checked);
}

async function saveEmpresa(id) {
  const nome = document.getElementById('ef-nome').value.trim();
  if (!nome) return toast('Nome obrigatório','var(--red)');
  const cnpj = document.getElementById('ef-cnpj').value.trim();
  const regime = document.getElementById('ef-reg').value;
  const ativo = parseInt(document.getElementById('ef-ativo').value);
  const tarefas_ids = [...document.querySelectorAll('.task-cb:checked')].map(cb=>+cb.dataset.id);
  try {
    if (id) await api(`/empresas/${id}`,'PUT',{nome,cnpj,regime,ativo,tarefas_ids});
    else    await api('/empresas','POST',{nome,cnpj,regime,tarefas_ids});
    closeModal(); toast(id?'Empresa atualizada!':'Empresa criada!');
    loadEmpresas();
    if(typeof loadNfseCofre === 'function') loadNfseCofre();
  } catch(e){ toast(e.erro||'Erro','var(--red)'); }
}
async function delEmpresa(id,nome) {
  if(!confirm(`Remover "${nome}"? Todas as execuções serão apagadas.`)) return;
  await api(`/empresas/${id}`,'DELETE');
  toast('Empresa removida.'); loadEmpresas();
}

// ─── TAREFAS ──────────────────────────────────────────────────────────────────
async function loadTarefas() {
  const rows = await api('/tarefas');
  document.querySelector('#tar-tbl tbody').innerHTML = rows.length
    ? rows.map(t=>`<tr>
        <td><b>${t.nome}</b></td>
        <td><span class="ctag">${t.categoria||'—'}</span></td>
        <td><span class="badge b-pe" style="font-family:'JetBrains Mono',monospace">${t.dia_vencimento?`Dia ${t.dia_vencimento.toString().padStart(2,'0')}`:'Sem prazo'}</span></td>
        <td style="font-size:11px;color:var(--mt)">${t.descricao||'—'}</td>
        <td style="text-align:right;display:flex;gap:5px;justify-content:flex-end">
          <button class="btn btn-g btn-sm" onclick="openTarefaModal(${t.id})">Editar</button>
          <button class="btn btn-d btn-sm" onclick="delTarefa(${t.id},'${t.nome.replace(/'/g,"\\'")}')">Remover</button>
        </td>
      </tr>`).join('')
    : `<tr><td colspan="5" class="empty">Nenhuma tarefa cadastrada.</td></tr>`;
}
async function openTarefaModal(id=null) {
  const t = id ? await api(`/tarefas/${id}`) : null;
  document.getElementById('m-title').textContent = t?'Editar tarefa':'Nova tarefa';
  document.getElementById('m-body').innerHTML=`
    <div style="display:flex;flex-direction:column;gap:12px">
      <div class="fg"><label>Nome *</label><input id="tf-nome" value="${t?.nome||''}" placeholder="ex: Escrituração Fiscal Mensal"/></div>
      <div class="fg2">
        <div class="fg"><label>Categoria</label>
          <select id="tf-cat">${CATS.map(c=>`<option ${t?.categoria===c?'selected':''}>${c}</option>`).join('')}</select>
        </div>
        <div class="fg"><label>Descrição</label><input id="tf-desc" value="${t?.descricao||''}" placeholder="Breve descrição"/></div>
        <div class="fg"><label>Vencimento (Dia)</label><input type="number" id="tf-venc" value="${t?.dia_vencimento||''}" min="1" max="31" placeholder="Ex: 20"/></div>
      </div>
    </div>`;
  document.getElementById('m-foot').innerHTML=`<button class="btn btn-g" onclick="closeModal()">Cancelar</button><button class="btn btn-p" onclick="saveTarefa(${id||'null'})">Salvar</button>`;
  document.getElementById('ov').classList.remove('hide');
}
async function saveTarefa(id) {
  const nome=document.getElementById('tf-nome').value.trim();
  if(!nome) return toast('Nome obrigatório','var(--red)');
  const categoria=document.getElementById('tf-cat').value;
  const descricao=document.getElementById('tf-desc').value.trim();
  let dia_vencimento=parseInt(document.getElementById('tf-venc').value); if(isNaN(dia_vencimento)) dia_vencimento=null;
  try {
    if(id) await api(`/tarefas/${id}`,'PUT',{nome,categoria,descricao,dia_vencimento});
    else   await api('/tarefas','POST',{nome,categoria,descricao,dia_vencimento});
    closeModal(); toast(id?'Tarefa atualizada!':'Tarefa criada!'); loadTarefas();
  } catch(e){ toast(e.erro||'Erro','var(--red)'); }
}
async function delTarefa(id,nome) {
  if(!confirm(`Remover tarefa "${nome}"?`)) return;
  await api(`/tarefas/${id}`,'DELETE');
  toast('Tarefa removida.'); loadTarefas();
}

// ─── EXEC MODAL ───────────────────────────────────────────────────────────────
async function openExecModal(id) {
  const r = await api(`/execucoes/${id}`);
  document.getElementById('m-title').textContent='Registrar execução';
  document.getElementById('m-body').innerHTML=`
    <div style="background:var(--surf2);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px">
      <div style="font-weight:500">${r.empresa_nome}</div>
      <div style="color:var(--mt);margin-top:2px">${r.tarefa_nome} · <span class="ctag">${r.categoria}</span></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:12px">
      <div class="fg"><label>Status</label>
        <select id="xf-sta">
          <option value="pendente" ${r.status==='pendente'?'selected':''}>⬜ Pendente</option>
          <option value="em_andamento" ${r.status==='em_andamento'?'selected':''}>🔄 Em andamento</option>
          <option value="concluida" ${r.status==='concluida'?'selected':''}>✅ Concluída</option>
          <option value="bloqueada" ${r.status==='bloqueada'?'selected':''}>⚠️ Bloqueada</option>
        </select>
      </div>
      <div class="fg"><label>O que foi feito</label><textarea id="xf-feito" placeholder="Descreva o que foi executado...">${r.o_que_foi_feito||''}</textarea></div>
      <div class="fg2">
        <div class="fg"><label>Quando</label><input type="date" id="xf-quando" value="${r.quando||''}"/></div>
        <div class="fg"><label>Responsável</label><input id="xf-resp" value="${r.responsavel||''}" placeholder="Nome"/></div>
      </div>
      <div class="fg"><label>Observações</label><textarea id="xf-obs" style="min-height:50px" placeholder="Observações adicionais...">${r.observacoes||''}</textarea></div>
    </div>`;
  document.getElementById('m-foot').innerHTML=`<button class="btn btn-g" onclick="closeModal()">Cancelar</button><button class="btn btn-p" onclick="saveExec(${id})">Salvar</button>`;
  document.getElementById('ov').classList.remove('hide');
}
async function saveExec(id) {
  const body={
    status:document.getElementById('xf-sta').value,
    o_que_foi_feito:document.getElementById('xf-feito').value.trim()||null,
    quando:document.getElementById('xf-quando').value||null,
    responsavel:document.getElementById('xf-resp').value.trim()||null,
    observacoes:document.getElementById('xf-obs').value.trim()||null
  };
  try { await api(`/execucoes/${id}`,'PUT',body); closeModal(); toast('Execução atualizada!'); loadExec(); }
  catch(e){ toast(e.erro||'Erro','var(--red)'); }
}

// ─── HIST MODAL ───────────────────────────────────────────────────────────────
async function openHistModal(id) {
  const r = await api(`/historico`);
  const rec = (await api(`/historico?`));
  // fetch single record via a workaround — filter from full list (or call PUT to get it)
  const all = await api('/historico');
  const h = all.find ? all : [];
  // Actually we need the single record; let's use the full list filtered
  const row = (await api('/historico')).find(x=>x.id===id);
  if (!row) return toast('Registro não encontrado','var(--red)');
  document.getElementById('m-title').textContent='Editar histórico';
  document.getElementById('m-body').innerHTML=`
    <div style="background:var(--surf2);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px">
      <div style="font-weight:500">${row.empresa_nome} · <span style="font-family:'JetBrains Mono',monospace">${fmes(row.mes_referencia)}</span></div>
      <div style="color:var(--mt);margin-top:2px">${row.tarefa_nome} · <span class="ctag">${row.categoria||'—'}</span></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:12px">
      <div class="fg"><label>Status</label>
        <select id="hf-sta">
          <option value="pendente" ${row.status==='pendente'?'selected':''}>⬜ Pendente</option>
          <option value="em_andamento" ${row.status==='em_andamento'?'selected':''}>🔄 Em andamento</option>
          <option value="concluida" ${row.status==='concluida'?'selected':''}>✅ Concluída</option>
          <option value="bloqueada" ${row.status==='bloqueada'?'selected':''}>⚠️ Bloqueada</option>
        </select>
      </div>
      <div class="fg"><label>O que foi feito</label><textarea id="hf-feito">${row.o_que_foi_feito||''}</textarea></div>
      <div class="fg2">
        <div class="fg"><label>Quando</label><input type="date" id="hf-quando" value="${row.quando||''}"/></div>
        <div class="fg"><label>Responsável</label><input id="hf-resp" value="${row.responsavel||''}"/></div>
      </div>
      <div class="fg"><label>Observações</label><textarea id="hf-obs" style="min-height:50px">${row.observacoes||''}</textarea></div>
    </div>`;
  document.getElementById('m-foot').innerHTML=`<button class="btn btn-g" onclick="closeModal()">Cancelar</button><button class="btn btn-p" onclick="saveHist(${id})">Salvar</button>`;
  document.getElementById('ov').classList.remove('hide');
}
async function saveHist(id) {
  const body={
    status:document.getElementById('hf-sta').value,
    o_que_foi_feito:document.getElementById('hf-feito').value.trim()||null,
    quando:document.getElementById('hf-quando').value||null,
    responsavel:document.getElementById('hf-resp').value.trim()||null,
    observacoes:document.getElementById('hf-obs').value.trim()||null
  };
  try { await api(`/historico/${id}`,'PUT',body); closeModal(); toast('Histórico atualizado!'); loadHist(); }
  catch(e){ toast(e.erro||'Erro','var(--red)'); }
}



// ─── Configurações e CSV ──────────────────────────────────────────────────────
async function initApp() {
  const token = localStorage.getItem('token');
  if (!token) {
    // Mostra tela de login (já visível por padrão), esconde o layout
    document.querySelector('.layout').style.display = 'none';
    return;
  }
  try {
    currentUser = await api('/auth/me');
    // Login válido: esconde overlay, mostra app
    document.getElementById('pg-login').style.display = 'none';
    document.querySelector('.layout').style.display = 'grid';
    if (currentUser.role !== 'admin') {
      document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
    }
  } catch(e) {
    // Token inválido: limpa e mostra login
    localStorage.removeItem('token');
    document.querySelector('.layout').style.display = 'none';
    return;
  }

  try {
    const cfg = await api('/configuracoes');
    document.querySelector('.logo-sub').textContent = cfg.nome_escritorio;
    const cfgInput = document.getElementById('cfg-nome-escritorio');
    if (cfgInput) cfgInput.value = cfg.nome_escritorio || '';
    const cfgPasta = document.getElementById('cfg-pasta-download');
    if (cfgPasta) cfgPasta.value = cfg.pasta_download_padrao || '';
  } catch(e) {}
  
  loadDash();
  loadNotificacoes();
  loadCompetencia();
}

async function loadConfiguracoes() {
  try {
    const cfg = await api('/configuracoes');
    const cfgInput = document.getElementById('cfg-nome-escritorio');
    if (cfgInput) cfgInput.value = cfg.nome_escritorio || '';
    const cfgPasta = document.getElementById('cfg-pasta-download');
    if (cfgPasta) cfgPasta.value = cfg.pasta_download_padrao || '';
  } catch(e) {
    console.error('Erro ao carregar configurações', e);
  }
}

async function saveConfiguracoes() {
  const nome_escritorio = document.getElementById('cfg-nome-escritorio').value.trim();
  const pasta_download_padrao = document.getElementById('cfg-pasta-download').value.trim();
  if (!nome_escritorio) return toast('Nome obrigatório', 'var(--red)');
  try {
    await api('/configuracoes', 'PUT', { nome_escritorio, pasta_download_padrao });
    document.querySelector('.logo-sub').textContent = nome_escritorio;
    toast('Configurações salvas!');
  } catch(e) { toast(e.erro||'Erro', 'var(--red)'); }
}

function downloadCsvModel() {
  const csvContent = "Nome,CNPJ,Regime\nEmpresa Exemplo LTDA,00.000.000/0001-00,SIMPLES";
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "modelo_empresas.csv";
  link.click();
}

function importCsv(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(e) {
    const text = e.target.result;
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l);
    if (lines.length <= 1) return toast('O CSV está vazio ou inválido', 'var(--red)');
    
    const empresas = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length >= 1 && parts[0]) {
        empresas.push({
          nome: parts[0].trim(),
          cnpj: parts[1] ? parts[1].trim() : '',
          regime: parts[2] ? parts[2].trim() : ''
        });
      }
    }
    if (empresas.length === 0) return toast('Nenhuma empresa encontrada no CSV', 'var(--red)');
    try {
      const r = await api('/empresas/import', 'POST', empresas);
      toast(r.mensagem || 'Empresas importadas!');
      loadEmpresas();
    } catch(err) { toast(err.erro||'Erro na importação', 'var(--red)'); }
    event.target.value = ''; // reset
  };
  reader.readAsText(file);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
initApp();

window.changeExecPage = function(dir) {
  const totalPages = Math.ceil(execTotal / PAGE_LIMIT) || 1;
  if (execPage + dir < 1 || execPage + dir > totalPages) return;
  execPage += dir;
  loadExec();
};

window.changeHistPage = function(dir) {
  const totalPages = Math.ceil(histTotal / PAGE_LIMIT) || 1;
  if (histPage + dir < 1 || histPage + dir > totalPages) return;
  histPage += dir;
  loadHist();
};


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

    list.innerHTML = alerts.map(a => {
      const isAtrasada = a.atrasada === 1;
      const color = isAtrasada ? 'var(--red)' : 'var(--p)';
      const bg = isAtrasada ? 'rgba(240,90,90,.08)' : 'rgba(79,127,255,.08)';
      const bdr = isAtrasada ? 'rgba(240,90,90,.2)' : 'rgba(79,127,255,.2)';
      const titulo = isAtrasada ? 'Tarefa Atrasada' : 'Próxima ao Vencimento';
      const icone = isAtrasada ? '⚠️' : '⏳';

      return `
        <div style="background:${bg};border:1px solid ${bdr};border-radius:8px;padding:12px 16px;display:flex;align-items:flex-start;gap:12px">
          <div style="font-size:20px">${icone}</div>
          <div>
            <div style="font-weight:600;font-size:13px;color:${color};margin-bottom:2px">${titulo} ${!isAtrasada ? '(3 dias)' : ''}</div>
            <div style="font-size:12px;color:var(--mt)">A tarefa <b>${a.tarefa_nome}</b> da empresa <b>${a.empresa_nome}</b> vence no dia <b>${a.dia_vencimento.toString().padStart(2,'0')}</b> e ainda está Pendente.</div>
            <button class="btn btn-sm btn-g" style="margin-top:8px" onclick="goExec(${a.id})">Ir para Execuções</button>
          </div>
        </div>
      `;
    }).join('');
  } catch(e) {
    console.error(e);
  }
}


async function doLogin() {
  const email = document.getElementById('login-email').value;
  const senha = document.getElementById('login-senha').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  if (!email || !senha) {
    errEl.textContent = 'Preencha e-mail e senha.';
    errEl.style.display = 'block';
    return;
  }
  try {
    const res = await api('/auth/login', 'POST', {email, senha});
    localStorage.setItem('token', res.token);
    currentUser = res.user;
    // Esconde login overlay, mostra app
    document.getElementById('pg-login').style.display = 'none';
    document.querySelector('.layout').style.display = 'grid';
    if (currentUser.role !== 'admin') {
      document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
    }
    try {
      const cfg = await api('/configuracoes');
      document.querySelector('.logo-sub').textContent = cfg.nome_escritorio;
      
      const cfgInput = document.getElementById('cfg-nome-escritorio');
      if (cfgInput) cfgInput.value = cfg.nome_escritorio || '';
      
      const cfgPasta = document.getElementById('cfg-pasta-download');
      if (cfgPasta) cfgPasta.value = cfg.pasta_download_padrao || '';
    } catch(e) {}
    loadDash();
    loadNotificacoes();
  } catch(e) {
    errEl.textContent = e.message || 'Credenciais inválidas';
    errEl.style.display = 'block';
  }
}

function doLogout() {
  localStorage.removeItem('token');
  window.location.reload();
}

// ─── NFS-E ────────────────────────────────────────────────────────────────────
function switchNfseTab(tab) {
  document.querySelectorAll('.tab-item').forEach(i => i.classList.remove('active'));
  document.querySelector(`.tab-item[data-sub="${tab}"]`).classList.add('active');
  document.querySelectorAll('.nfse-section').forEach(s => s.style.display = 'none');
  document.getElementById(`nfse-sec-${tab}`).style.display = 'block';
  if (tab === 'cofre') loadNfseCofre();
  if (tab === 'capturar') loadNfseEmpresas();
  if (tab === 'historico') loadNfseHistorico();
}

async function loadNfseCofre() {
  const data = await api('/cofre-nfse');
  document.querySelector('#nfse-cofre-tbl tbody').innerHTML = data.map(e => `
    <tr>
      <td><b>${e.nome}</b></td>
      <td>${e.cnpj || '—'}</td>
      <td>${e.usuario || e.cnpj || '—'}</td>
      <td>${e.configurado ? '<span class="badge b-ok">Configurado</span>' : '<span class="badge b-pe">Sem credencial</span>'}</td>
      <td>${fdate(e.atualizado_em?.split(' ')[0])}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-g btn-sm" onclick="openCofreModal(${e.id}, '${e.nome}', '${e.usuario||e.cnpj||''}')">🔑 Configurar</button>
        ${e.configurado ? `<button class="btn btn-d btn-sm" onclick="deleteCofre(${e.id})">Remover</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="empty">Nenhuma empresa encontrada.</td></tr>';
}

function openCofreModal(id, nome, usuario) {
  mTitle.innerText = 'Configurar Credencial: ' + nome;
  mBody.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="fg">
        <label>Usuário (CNPJ com pontuação)</label>
        <input type="text" id="cofre-usuario" value="${usuario}" placeholder="XX.XXX.XXX/XXXX-XX">
      </div>
      <div class="fg">
        <label>Senha do Portal NFS-e</label>
        <input type="password" id="cofre-senha" placeholder="••••••••">
      </div>
    </div>
  `;
  mFoot.innerHTML = `
    <button class="btn btn-g" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-p" onclick="saveCofre(${id})">Salvar no Cofre</button>
  `;
  openModal();
}

async function saveCofre(empresaId) {
  const usuario = document.getElementById('cofre-usuario').value;
  const senha = document.getElementById('cofre-senha').value;
  if (!usuario || !senha) return toast('Preencha Usuário e Senha.');
  
  try {
    await api('/cofre-nfse/' + empresaId, 'PUT', { usuario, senha });
    toast('Credencial salva com sucesso!');
    closeModal();
    loadNfseCofre();
  } catch (e) {
    toast('Erro ao salvar credencial: ' + e.message);
  }
}

async function deleteCofre(id) {
  if (!confirm('Deseja realmente remover a credencial desta empresa?')) return;
  await api('/cofre-nfse/' + id, 'DELETE');
  toast('Credencial removida.');
  loadNfseCofre();
}

async function loadNfseEmpresas() {
  const data = await api('/cofre-nfse');
  const configured = data.filter(e => e.configurado);
  const sel = document.getElementById('nfse-cap-empresa');
  
  let options = configured.map(e => `<option value="${e.id}" data-cnpj="${e.cnpj||''}">${e.nome}</option>`).join('');
  if (configured.length > 1) {
    options = `<option value="all" style="font-weight:bold;color:var(--p)">✨ TODAS AS EMPRESAS (${configured.length})</option>` + options;
  }
  
  sel.innerHTML = options;
  if (configured.length === 0) sel.innerHTML = '<option value="">Nenhuma empresa configurada no Cofre</option>';

  // ── Preenche datas com o mês atual (1º ao último dia) ──────────────────────
  const hoje = new Date();
  const ano  = hoje.getFullYear();
  const mes  = String(hoje.getMonth() + 1).padStart(2, '0');
  const ultimoDia = new Date(ano, hoje.getMonth() + 1, 0).getDate();

  const inputInicio = document.getElementById('nfse-cap-inicio');
  const inputFim    = document.getElementById('nfse-cap-fim');

  if (!inputInicio.value) inputInicio.value = `${ano}-${mes}-01`;
  if (!inputFim.value)    inputFim.value    = `${ano}-${mes}-${String(ultimoDia).padStart(2, '0')}`;

  // ── Regra: ambas as datas devem estar dentro do mesmo mês ─────────────────
  function corrigirMes(origem, destino, posicao) {
    const val = origem.value;
    if (!val) return;
    const [y, m] = val.split('-');
    const ult = new Date(parseInt(y), parseInt(m), 0).getDate();
    // Ajusta destino para o mesmo ano/mês
    if (posicao === 'inicio') {
      // Ao alterar início, ajusta fim para o último dia do mesmo mês
      destino.value = `${y}-${m}-${String(ult).padStart(2, '0')}`;
      destino.min = `${y}-${m}-01`;
      destino.max = `${y}-${m}-${String(ult).padStart(2, '0')}`;
    } else {
      // Ao alterar fim, ajusta início para o primeiro dia do mesmo mês
      destino.value = `${y}-${m}-01`;
      destino.min = `${y}-${m}-01`;
      destino.max = `${y}-${m}-${String(ult).padStart(2, '0')}`;
    }
    // Define limites no próprio campo alterado
    origem.min = `${y}-${m}-01`;
    origem.max = `${y}-${m}-${String(ult).padStart(2, '0')}`;
  }

  // Aplica limites iniciais
  corrigirMes(inputInicio, inputFim, 'inicio');

  // Remove eventos antigos e adiciona novos
  const novoInicio = inputInicio.cloneNode(true);
  const novoFim    = inputFim.cloneNode(true);
  inputInicio.parentNode.replaceChild(novoInicio, inputInicio);
  inputFim.parentNode.replaceChild(novoFim, inputFim);

  novoInicio.addEventListener('change', () => corrigirMes(novoInicio, novoFim, 'inicio'));
  novoFim.addEventListener('change',    () => corrigirMes(novoFim, novoInicio, 'fim'));

  // Show/Hide ZIP toggle based on type
  document.querySelectorAll('input[name="nfse-tipo-cap"]').forEach(r => {
    r.addEventListener('change', (e) => {
      document.getElementById('nfse-zip-container').style.display = e.target.value === 'lista' ? 'none' : 'block';
    });
  });
}


async function executarCaptura() {
  const btn = document.getElementById('btn-nfse-exec');
  const empresa_id = document.getElementById('nfse-cap-empresa').value;
  const tipo_nota = document.querySelector('input[name="nfse-tipo-nota"]:checked').value;
  const tipo_captura = document.querySelector('input[name="nfse-tipo-cap"]:checked').value;
  const data_inicio = document.getElementById('nfse-cap-inicio').value;
  const data_fim = document.getElementById('nfse-cap-fim').value;

  if (!empresa_id || !data_inicio || !data_fim) return toast('Preencha os campos obrigatórios.');

  const d_ini = data_inicio.split('-').reverse().join('/');
  const d_fim = data_fim.split('-').reverse().join('/');

  btn.disabled = true;
  btn.innerHTML = '<span class="loader-nfse"></span> Iniciando...';
  document.getElementById('nfse-resultado-container').style.display = 'none';

  // ── MODO BATCH (Múltiplas Empresas) ────────────────────────────────────────
  if (empresa_id === 'all') {
    try {
      const data = await api('/cofre-nfse');
      const empresas = data.filter(e => e.configurado).map(e => ({ cnpj: e.cnpj, empresaId: e.id }));
      
      const res = await api('/nfse/capturar-batch', 'POST', {
        dataInicio: d_ini,
        dataFim: d_fim,
        tipo: `${tipo_nota}:${tipo_captura}`,
        empresas
      });

      toast(`✅ ${res.total} empresas enfileiradas com sucesso!`);
      btn.disabled = false;
      btn.innerHTML = '▶ Iniciar Captura';
      
      // Muda para a aba de histórico para acompanhar o progresso de todos
      setTimeout(() => switchNfseTab('historico'), 1500);
      return;
    } catch (e) {
      toast('Erro no lote: ' + (e.message || e.erro), 'var(--red)');
      btn.disabled = false;
      btn.innerHTML = '▶ Iniciar Captura';
      return;
    }
  }

  // ── MODO INDIVIDUAL ────────────────────────────────────────────────────────
  const empresaOpt = document.getElementById('nfse-cap-empresa');
  const cnpj = empresaOpt.options[empresaOpt.selectedIndex]?.dataset?.cnpj || '';

  try {
    // v4: retorna jobId imediatamente
    const res = await api('/nfse/capturar', 'POST', {
      cnpj,
      tipo: `${tipo_nota}:${tipo_captura}`,
      dataInicio: d_ini,
      dataFim: d_fim,
      empresaId: parseInt(empresa_id),
    });

    if (!res.jobId) throw new Error(res.erro || 'Resposta inesperada do servidor.');

    toast('Captura enfileirada! Aguardando processamento...');
    btn.innerHTML = '<span class="loader-nfse"></span> Processando...';

    // Polling a cada 3s até concluir ou dar erro
    await new Promise((resolve, reject) => {
      const interval = setInterval(async () => {
        try {
          const job = await api(`/nfse/jobs/${res.jobId}`);
          if (job.status === 'concluido') {
            clearInterval(interval);
            toast('✅ Captura concluída!');
            exibirResultadoNfse(job.resultado || {}, tipo_captura, res.jobId);
            resolve();

          } else if (job.status === 'erro') {
            clearInterval(interval);
            reject(new Error(job.erro || 'Falha no processamento.'));
          }
        } catch (pollErr) {
          clearInterval(interval);
          reject(pollErr);
        }
      }, 3000);
    });

  } catch (e) {
    toast('Erro na captura: ' + (e.message || e.erro));
  } finally {
    btn.disabled = false;
    btn.innerHTML = '▶ Iniciar Captura';
  }
}



function exibirResultadoNfse(res, tipo, jobId) {
  const container = document.getElementById('nfse-resultado-container');
  const info = document.getElementById('nfse-res-info');
  const listWrapper = document.getElementById('nfse-res-lista-wrapper');
  const downloadWrapper = document.getElementById('nfse-res-download-wrapper');
  
  container.style.display = 'block';
  const totalNotas = res.total_notas ?? 0;
  const valorTotal = res.valor_total ?? 0;
  info.innerHTML = `<b>Total de notas:</b> ${totalNotas}${valorTotal > 0 ? ` | <b>Valor Total:</b> R$ ${valorTotal.toLocaleString('pt-BR', {minimumFractionDigits:2})}` : ''}`;

  if (tipo === 'lista') {
    listWrapper.style.display = 'block';
    downloadWrapper.style.display = 'none';
    const notas = Array.isArray(res.notas) ? res.notas : [];
    document.querySelector('#nfse-res-tbl tbody').innerHTML = notas.length
      ? notas.map(n => `
        <tr>
          <td>${n.numero}</td>
          <td>${n.data_emissao}</td>
          <td>${n.tomador_prestador}</td>
          <td>${n.cnpj_cpf}</td>
          <td>R$ ${(n.valor||0).toLocaleString('pt-BR', {minimumFractionDigits:2})}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="5" class="empty">Nenhuma nota encontrada.</td></tr>';
  } else {
    listWrapper.style.display = 'none';
    downloadWrapper.style.display = 'block';
    const link = document.getElementById('nfse-res-link');
    // v4: usa o jobId para gerar o link via rota de token
    const idParaDownload = res.capturaId || res.id || jobId;
    link.onclick = (e) => {
      e.preventDefault();
      downloadZip(idParaDownload);
    };
    link.href = '#';
  }
  
  container.scrollIntoView({ behavior: 'smooth' });
}

async function downloadZip(id) {
  const token = localStorage.getItem('token');
  try {
    const res = await fetch(`/api/nfse/gerar-link/${id}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.url) {
      window.open(data.url, '_blank');
    } else {
      alert('Erro ao gerar link de download: ' + (data.erro || 'Desconhecido'));
    }
  } catch (e) {
    console.error('Erro no download:', e);
    alert('Erro na conexão com o servidor.');
  }
}

async function loadNfseHistorico() {
  const data = await api('/nfse/capturas');
  document.querySelector('#nfse-hist-tbl tbody').innerHTML = data.map(c => `
    <tr>
      <td style="font-size:11px">${fdate(c.capturado_em.split(' ')[0])}</td>
      <td><b>${c.empresa_nome}</b></td>
      <td style="font-size:11px">${c.data_inicio} - ${c.data_fim}</td>
      <td><span class="ctag">${c.tipo_nota.toUpperCase()} (${c.tipo_captura.toUpperCase()})</span></td>
      <td>${c.status === 'concluida' ? '<span class="badge b-ok">Sucesso</span>' : '<span class="badge b-bl">Erro</span>'}</td>
      <td>${c.total_notas}</td>
      <td style="text-align:right">
        ${c.arquivo_zip ? `<button class="btn btn-g btn-sm" onclick="downloadZip(${c.id})">📥 Download ZIP</button>` : '—'}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="empty">Nenhuma captura realizada ainda.</td></tr>';
}

function openNovoAcessoModal() {
  mTitle.innerText = 'Adicionar Novo Acesso NFS-e';
  mBody.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px">
      <div style="background:rgba(79,127,255,.05);padding:12px;border-radius:8px;font-size:12px;color:var(--mt);border:1px solid rgba(79,127,255,.1)">
        Este cadastro criará a empresa no sistema e salvará as credenciais de acesso ao portal NFS-e simultaneamente.
      </div>
      <div class="fg">
        <label>Nome da Empresa (Razão Social)</label>
        <input type="text" id="na-nome" placeholder="Ex: Minha Empresa LTDA">
      </div>
      <div class="fg">
        <label>CNPJ (Usuário NFS-e)</label>
        <input type="text" id="na-cnpj" placeholder="XX.XXX.XXX/XXXX-XX">
      </div>
      <div class="fg">
        <label>Senha do Portal NFS-e</label>
        <input type="password" id="na-senha" placeholder="••••••••">
      </div>
      <div class="fg">
        <label>Regime Tributário</label>
        <select id="na-reg">
          ${REGIMES.map(r=>`<option value="${r}">${r}</option>`).join('')}
          <option value="">Não informado</option>
        </select>
      </div>
    </div>
  `;
  mFoot.innerHTML = `
    <button class="btn btn-g" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-p" onclick="saveNovoAcesso()">Salvar e Configurar</button>
  `;
  openModal();
}

async function saveNovoAcesso() {
  const nome = document.getElementById('na-nome').value.trim();
  const cnpj = document.getElementById('na-cnpj').value.trim();
  const senha = document.getElementById('na-senha').value.trim();
  const regime = document.getElementById('na-reg').value;

  if (!nome || !cnpj || !senha) return toast('Preencha nome, CNPJ e senha.');

  try {
    // 1. Cria a empresa
    const emp = await api('/empresas', 'POST', { nome, cnpj, regime, tarefas_ids: [] });
    
    // 2. Salva a credencial
    await api('/cofre-nfse/' + emp.id, 'PUT', { usuario: cnpj, senha });
    
    toast('Empresa e Acesso NFS-e criados com sucesso!');
    closeModal();
    loadNfseCofre();
    loadEmpresas();
  } catch (e) {
    toast('Erro: ' + (e.erro || e.message));
  }
}


// ─── NF-e DISTRIBUIÇÃO ────────────────────────────────────────────────────────

function initDistribuicaoForm() {
  const input = document.getElementById('dist-competencia');
  if (input && !input.value) {
    const now = new Date();
    input.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    api('/competencia').then(r => { if (r.competencia_ativa && input) input.value = r.competencia_ativa; }).catch(()=>{});
  }
  api('/certificados').then(rows => {
    const sel = document.getElementById('dist-empresa-id');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Todas com certificado —</option>';
    rows.filter(r => r.configurado).forEach(r => {
      sel.innerHTML += `<option value="${r.id}">${r.nome}</option>`;
    });
  }).catch(()=>{});
}

async function loadDistribuicaoStatus() {
  const el = document.getElementById('distribuicao-status');
  if (!el) return;
  try {
    const rows = await api('/nfe-distribuicao/status');
    if (!rows.length) { el.innerHTML = '<div style="color:var(--mt)">Nenhuma empresa cadastrada.</div>'; return; }
    el.innerHTML = `<table class="table"><thead><tr>
      <th>Empresa</th><th>CNPJ</th><th>Certificado</th><th>Último NSU</th><th>Última Sync</th><th></th>
    </tr></thead><tbody>
      ${rows.map(r => `<tr>
        <td>${r.nome}</td>
        <td>${r.cnpj}</td>
        <td>${r.tem_certificado ? '<span class="badge b-ok">✓</span>' : '<span class="badge b-pe">Sem cert.</span>'}</td>
        <td style="font-family:monospace">${r.ult_nsu || 0}</td>
        <td>${r.ultima_sync ? r.ultima_sync.substring(0,16) : '—'}</td>
        <td style="text-align:right">
          ${r.tem_certificado ? `<button class="btn btn-g btn-sm" onclick="resetNSU(${r.id},'${r.nome}')">Zerar NSU</button>` : ''}
        </td>
      </tr>`).join('')}
    </tbody></table>`;
  } catch(e) {
    el.innerHTML = '<div style="color:var(--red)">Erro ao carregar status.</div>';
  }
}

async function resetNSU(empresaId, nome) {
  if (!confirm(`Zerar NSU de "${nome}"?\nPróxima sincronização buscará TODOS os documentos.`)) return;
  try {
    await api(`/nfe-distribuicao/reset-nsu/${empresaId}`, 'POST');
    toast('NSU zerado com sucesso.');
    loadDistribuicaoStatus();
  } catch(e) { toast('Erro ao zerar NSU.'); }
}

async function syncDistribuicao(resetNsu) {
  if (resetNsu && !confirm('Sync Completa irá reprocessar desde o NSU 0.\nIsso pode demorar bastante. Continuar?')) return;

  const empresaId  = document.getElementById('dist-empresa-id').value;
  const competencia = document.getElementById('dist-competencia').value;
  const logs = document.getElementById('dist-logs');
  const btn  = document.getElementById('btn-dist-sync');

  logs.innerHTML = '<div>⏳ Iniciando consulta NFeDistribuicaoDFe...</div>';
  if (btn) { btn.disabled = true; btn.innerText = '⏳ Sincronizando...'; }

  try {
    const body = { reset_nsu: resetNsu };
    if (empresaId)   body.empresa_id   = empresaId;
    if (competencia) body.competencia   = competencia;

    const res = await api('/nfe-distribuicao/sync', 'POST', body);

    logs.innerHTML = (res.detalhes || []).map(l => {
      const cor = l.startsWith('✅') || l.startsWith('💾') ? 'var(--green)'
                : l.startsWith('❌') ? 'var(--red)'
                : l.startsWith('⚠️') ? 'var(--yellow, #f59e0b)'
                : 'var(--mt)';
      return `<div style="color:${cor}">${l}</div>`;
    }).join('');
    logs.scrollTop = logs.scrollHeight;
    toast(res.mensagem);
    loadDistribuicaoStatus();
  } catch(e) {
    logs.innerHTML = `<div style="color:var(--red)">Erro: ${e.erro || e.message}</div>`;
    toast('Erro na sincronização.');
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = '🔄 Sincronizar'; }
  }
}

// ─── Certificados na aba Distribuição ────────────────────────────────────────

async function loadDistribuicaoCerts() {
  const el = document.getElementById('dist-certificados-lista');
  if (!el) return;
  try {
    const rows = await api('/certificados');
    if (!rows.length) { el.innerHTML = '<div style="color:var(--mt)">Nenhuma empresa cadastrada.</div>'; return; }
    el.innerHTML = `<table class="table"><thead><tr>
      <th>Empresa</th><th>CNPJ</th><th>Validade</th><th>Status</th><th></th>
    </tr></thead><tbody>
      ${rows.map(r => `<tr>
        <td>${r.nome}</td>
        <td>${r.cnpj}</td>
        <td>${r.validade ? fdate(r.validade) : '—'}</td>
        <td>${r.configurado ? '<span class="badge b-ok">✓ Configurado</span>' : '<span class="badge b-pe">Sem certificado</span>'}</td>
        <td style="text-align:right;display:flex;gap:6px;justify-content:flex-end">
          <button class="btn btn-g btn-sm" onclick="abrirModalCertDist(${r.id})">Upload .pfx</button>
          ${r.configurado ? `<button class="btn btn-sm" style="background:var(--red);color:#fff" onclick="removerCertDist(${r.id})">Remover</button>` : ''}
        </td>
      </tr>`).join('')}
    </tbody></table>`;
  } catch(e) {
    el.innerHTML = '<div style="color:var(--red)">Erro ao carregar certificados.</div>';
  }
}

function abrirModalCertDist(empresaId) {
  document.getElementById('dist-cert-empresa-id').value = empresaId;
  document.getElementById('dist-cert-pfx-file').value = '';
  document.getElementById('dist-cert-senha').value = '';
  document.getElementById('dist-cert-validade').value = '';
  const modal = document.getElementById('modal-cert-dist');
  modal.style.display = 'flex';
}

function fecharModalCertDist() {
  document.getElementById('modal-cert-dist').style.display = 'none';
}

async function salvarCertificadoDist() {
  const empresaId = document.getElementById('dist-cert-empresa-id').value;
  const pfxFile   = document.getElementById('dist-cert-pfx-file').files[0];
  const senha     = document.getElementById('dist-cert-senha').value.trim();
  const validade  = document.getElementById('dist-cert-validade').value;

  if (!pfxFile) return toast('Selecione o arquivo .pfx.');
  if (!senha)   return toast('Informe a senha do certificado.');

  const formData = new FormData();
  formData.append('pfx', pfxFile);
  formData.append('senha', senha);
  if (validade) formData.append('validade', validade);

  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/certificados/${empresaId}`, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw data;
    toast('Certificado salvo com sucesso!');
    fecharModalCertDist();
    loadDistribuicaoCerts();
    loadDistribuicaoStatus();
    initDistribuicaoForm();
  } catch(e) {
    toast('Erro: ' + (e.erro || e.message || 'Falha ao salvar'));
  }
}

async function removerCertDist(empresaId) {
  if (!confirm('Remover certificado desta empresa?')) return;
  try {
    await api('/certificados/' + empresaId, 'DELETE');
    toast('Certificado removido.');
    loadDistribuicaoCerts();
    loadDistribuicaoStatus();
    initDistribuicaoForm();
  } catch(e) { toast('Erro ao remover.'); }
}
