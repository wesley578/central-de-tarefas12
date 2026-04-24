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
      configuracoes: () => {},
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
async function loadExec() {
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
      <div class="ccs"><span>✓ ${r.concluidas}</span><span>· ${r.pendentes}</span>${r.bloqueadas?`<span>✕ ${r.bloqueadas}</span>`:''}</div>
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
    toast(`✓ ${fmes(mes)} arquivado! ${r.total} registros salvos.`);
    loadDash();
  loadNotificacoes();
  } catch(e){ toast(e.erro||'Erro ao fechar mês','var(--red)'); }
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

function closeModal(){ document.getElementById('ov').classList.add('hide'); }

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
    if (cfgInput) cfgInput.value = cfg.nome_escritorio;
  } catch(e) {}
  
  loadDash();
  loadNotificacoes();
}

async function saveConfiguracoes() {
  const nome_escritorio = document.getElementById('cfg-nome-escritorio').value.trim();
  if (!nome_escritorio) return toast('Nome obrigatório', 'var(--red)');
  try {
    await api('/configuracoes', 'PUT', { nome_escritorio });
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
    const lines = text.split('\\n').map(l => l.trim()).filter(l => l);
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

    list.innerHTML = alerts.map(a => `
      <div style="background:rgba(240,90,90,.08);border:1px solid rgba(240,90,90,.2);border-radius:8px;padding:12px 16px;display:flex;align-items:flex-start;gap:12px">
        <div style="font-size:20px">⚠️</div>
        <div>
          <div style="font-weight:600;font-size:13px;color:var(--red);margin-bottom:2px">Tarefa Atrasada</div>
          <div style="font-size:12px;color:var(--mt)">A tarefa <b>${a.tarefa_nome}</b> da empresa <b>${a.empresa_nome}</b> venceu no dia <b>${a.dia_vencimento.toString().padStart(2,'0')}</b> e ainda está Pendente/Em Andamento.</div>
          <button class="btn btn-sm btn-g" style="margin-top:8px" onclick="goExec(${a.empresa_id})">Ir para Execuções</button>
        </div>
      </div>
    `).join('');
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
      if (cfgInput) cfgInput.value = cfg.nome_escritorio;
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
