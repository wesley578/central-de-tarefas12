/**
 * notion-integration.js
 * Módulo central de integração com o Notion.
 * Antigravity AI 2026 — NFS-e v4
 *
 * Variáveis de ambiente necessárias:
 *   NOTION_API_KEY      — Integration token do Notion (secret_xxx)
 *   NOTION_DATABASE_ID  — ID da database "NFS-e Jobs"
 */

const NOTION_VERSION = '2022-06-28';
const BASE_URL = 'https://api.notion.com/v1';

// ─── Utilitários de requisição ────────────────────────────────────────────────

function getHeaders() {
  const key = process.env.NOTION_API_KEY;
  if (!key) throw new Error('[Notion] NOTION_API_KEY não definida no ambiente.');
  return {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION,
  };
}

async function notionRequest(method, path, body = null) {
  const fetch = (await import('node-fetch')).default;
  const opts = { method, headers: getHeaders() };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const data = await res.json();
  if (!res.ok) {
    const msg = data.message || JSON.stringify(data);
    throw new Error(`[Notion] ${res.status} — ${msg}`);
  }
  return data;
}

// ─── Helpers de propriedades Notion ──────────────────────────────────────────

function richText(content) {
  return [{ type: 'text', text: { content: String(content ?? '') } }];
}

function selectProp(name) {
  return { select: { name } };
}

// ─── Item 01: Registro de job concluído/erro ──────────────────────────────────

/**
 * Registra um job na database Notion ao final da execução.
 * Chamado pelo callback de conclusão do nfse-queue.js.
 *
 * @param {object} job - Objeto do job conforme salvo em nfse_jobs
 * @param {object} resultado - Objeto retornado pelo robô (nfse.js)
 */
async function registrarJobNotion(job, resultado = {}) {
  const dbId = process.env.NOTION_DATABASE_ID;
  if (!dbId) {
    console.warn('[Notion] NOTION_DATABASE_ID não definida — registro ignorado.');
    return null;
  }

  const status = resultado.erro ? 'Erro' : 'Concluído';
  const empresa = job.empresa || job.cnpj || 'Não identificada';
  const periodo = (job.dataInicio && job.dataFim)
    ? `${job.dataInicio} a ${job.dataFim}`
    : job.dataInicio || 'Não informado';

  const notasCapturadas = typeof resultado.total_notas === 'number'
    ? resultado.total_notas
    : (resultado.notas?.length ?? resultado.totalNotas ?? 0);
  const duracaoMs = resultado.duracaoMs ?? 0;
  const duracaoStr = duracaoMs > 0
    ? `${Math.round(duracaoMs / 1000)}s`
    : 'desconhecida';
  const tentativas = job.tentativas ?? 1;

  const obs = resultado.erro
    ? `Erro: ${resultado.erro}`
    : `${notasCapturadas} nota(s) capturada(s) em ${duracaoStr}. Tentativas: ${tentativas}.`;

  const page = await notionRequest('POST', '/pages', {
    parent: { database_id: dbId },
    properties: {
      // title = Empresa
      'Empresa': { title: richText(empresa) },
      'CNPJ': { rich_text: richText(job.cnpj ?? '') },
      'Período': { rich_text: richText(periodo) },
      'Status': selectProp(status),
      'Observação': { rich_text: richText(obs) },
      'Data do Job': { date: { start: new Date().toISOString().split('T')[0] } },
      // ── Colunas do schema completo (Item 02) ──
      'Notas capturadas': { number: notasCapturadas },
      'Duração (s)': { number: Math.round(duracaoMs / 1000) },
      'Tentativas': { number: tentativas },
      'Job ID': { rich_text: richText(job.id ?? '') },
      'Link ZIP': { url: resultado.linkZip || null },
    },
  });

  console.log(`[Notion] Job ${job.id} registrado: ${page.url}`);
  return page;
}

// ─── Item 03: Log de erro estruturado como ticket ─────────────────────────────

/**
 * Cria um ticket de erro no Notion após esgotar todos os retries.
 * Chamado quando job.tentativas >= MAX_RETRIES e ainda houver falha.
 *
 * @param {object} job   - Objeto do job
 * @param {Error}  error - Erro capturado na última tentativa
 */
async function criarTicketErro(job, error) {
  const dbId = process.env.NOTION_DATABASE_ID;
  if (!dbId) return null;

  const stack = error?.stack || error?.message || String(error);
  const tituloTicket = `[ERRO] ${job.cnpj} — ${new Date().toLocaleDateString('pt-BR')}`;

  const page = await notionRequest('POST', '/pages', {
    parent: { database_id: dbId },
    properties: {
      'Empresa': { title: richText(tituloTicket) },
      'CNPJ': { rich_text: richText(job.cnpj ?? '') },
      'Período': { rich_text: richText(`${job.dataInicio ?? ''} a ${job.dataFim ?? ''}`) },
      'Status': selectProp('Erro'),
      'Observação': { rich_text: richText(`Falha após ${job.tentativas} tentativas.\n\n${stack}`.slice(0, 2000)) },
      'Data do Job': { date: { start: new Date().toISOString().split('T')[0] } },
      'Notas capturadas': { number: 0 },
      'Tentativas': { number: job.tentativas ?? 3 },
      'Job ID': { rich_text: richText(job.id ?? '') },
      'Link ZIP': { url: null },
    },
  });

  console.error(`[Notion] Ticket de erro criado para job ${job.id}: ${page.url}`);
  return page;
}

// ─── Utilitário: verificar/criar database ────────────────────────────────────

/**
 * Busca a database "NFS-e Jobs" no workspace.
 * Se não encontrar, cria com o schema completo (Item 02).
 * Retorna o ID da database e salva em process.env.NOTION_DATABASE_ID.
 *
 * @param {string} [parentPageId] - ID da página pai (opcional)
 */
async function garantirDatabase(parentPageId = null) {
  // Tenta buscar database existente
  const search = await notionRequest('POST', '/search', {
    query: 'NFS-e Jobs',
    filter: { value: 'database', property: 'object' },
  });

  const existing = search.results?.find(r => r.title?.[0]?.plain_text === 'NFS-e Jobs');
  if (existing) {
    process.env.NOTION_DATABASE_ID = existing.id;
    console.log(`[Notion] Database existente encontrada: ${existing.id}`);
    return existing.id;
  }

  if (!parentPageId) {
    throw new Error('[Notion] Database não encontrada e parentPageId não fornecido para criação.');
  }

  // Cria database com schema completo (Item 02)
  const db = await notionRequest('POST', '/databases', {
    parent: { page_id: parentPageId },
    title: richText('NFS-e Jobs'),
    properties: {
      'Empresa':           { title: {} },
      'CNPJ':              { rich_text: {} },
      'Período':           { rich_text: {} },
      'Status':            { select: { options: [
        { name: 'Concluído',   color: 'green'  },
        { name: 'Erro',        color: 'red'    },
        { name: 'Processando', color: 'yellow' },
        { name: 'Pendente',    color: 'gray'   },
      ]}},
      'Observação':        { rich_text: {} },
      'Data do Job':       { date: {} },
      'Notas capturadas':  { number: { format: 'number' } },
      'Duração (s)':       { number: { format: 'number' } },
      'Tentativas':        { number: { format: 'number' } },
      'Job ID':            { rich_text: {} },
      'Link ZIP':          { url: {} },
    },
  });

  process.env.NOTION_DATABASE_ID = db.id;
  console.log(`[Notion] Database criada: ${db.id}`);
  return db.id;
}

module.exports = { registrarJobNotion, criarTicketErro, garantirDatabase };
