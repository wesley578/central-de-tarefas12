/**
 * nfse-routes-v4.js
 * Rotas NFS-e v4 — drop-in replacement para os endpoints /api/nfse/* do server.js
 *
 * O que mudou em relação à v3:
 *  • POST /api/nfse/capturar       → retorna {jobId} imediatamente (não bloqueia)
 *  • GET  /api/nfse/jobs/:id       → polling de status do job
 *  • POST /api/nfse/capturar-batch → múltiplas empresas de uma vez
 *  • POST /api/nfse/gerar-link/:id → tokens persistidos no banco (não em memória)
 *  • GET  /api/nfse/arquivo/:token → sem mudança de interface, mas usa banco agora
 *
 * Como integrar ao server.js:
 *   const { criarRotasNfse } = require('./nfse-routes-v4');
 *   criarRotasNfse(app, { db, queue, tokens, autenticar, requireAdmin });
 */

'use strict';

const path = require('path');
const fs   = require('fs');

/**
 * Registra todas as rotas NFS-e no app Express.
 *
 * @param {import('express').Application} app
 * @param {object} deps
 * @param {import('better-sqlite3').Database} deps.db
 * @param {import('./nfse-queue').NfseQueue}   deps.queue
 * @param {import('./nfse-tokens').TokenManager} deps.tokens
 * @param {Function} deps.autenticar    - middleware JWT (req, res, next)
 * @param {Function} deps.requireAdmin  - middleware de role admin
 */
function criarRotasNfse(app, { db, queue, tokens, autenticar, requireAdmin }) {

  // ── Statements reutilizados ────────────────────────────────────────────────

  const stmtListarCapturas = db.prepare(`
    SELECT * FROM capturas_nfse
    ORDER BY capturado_em DESC
    LIMIT 50
  `);


  const stmtBuscarCaptura = db.prepare(`
    SELECT * FROM capturas_nfse WHERE id = ?
  `);

  const stmtListarJobs = db.prepare(`
    SELECT * FROM nfse_jobs
    ORDER BY criado_em DESC
    LIMIT 50
  `);

  const stmtBuscarJob = db.prepare(`
    SELECT * FROM nfse_jobs WHERE id = ?
  `);

  const stmtBuscarCapturaOuJob = (id) => {
    // Tenta capturas legadas (numérico)
    if (!isNaN(parseInt(id, 10)) && !id.includes('-')) {
      const c = db.prepare('SELECT arquivo_zip FROM capturas_nfse WHERE id = ?').get(id);
      if (c) return c.arquivo_zip;
    }
    // Tenta jobs v4 (UUID)
    const j = db.prepare('SELECT resultado FROM nfse_jobs WHERE id = ?').get(id);
    if (j && j.resultado) {
      try {
        const res = JSON.parse(j.resultado);
        return res.zip || res.arquivo_zip;
      } catch (e) { return null; }
    }
    return null;
  };

  // ── GET /api/nfse/capturas ─────────────────────────────────────────────────
  // Lista as últimas 50 capturas com status. Sem alteração de interface.

  app.get('/api/nfse/capturas', autenticar, requireAdmin, (req, res) => {
    try {
      const capturas = stmtListarCapturas.all();
      res.json(capturas);
    } catch (err) {
      console.error('[NFS-e] Erro ao listar capturas:', err.message);
      res.status(500).json({ erro: 'Erro ao listar capturas.' });
    }
  });

  // ── GET /api/nfse/jobs ─────────────────────────────────────────────────────
  // Lista os últimos 50 jobs (async) para acompanhamento no frontend.

  app.get('/api/nfse/jobs', autenticar, requireAdmin, (req, res) => {
    try {
      const jobs = stmtListarJobs.all().map(_formatarJob);
      res.json(jobs);
    } catch (err) {
      console.error('[NFS-e] Erro ao listar jobs:', err.message);
      res.status(500).json({ erro: 'Erro ao listar jobs.' });
    }
  });

  // ── GET /api/nfse/jobs/:id ─────────────────────────────────────────────────
  // Polling de status de um job específico.
  //
  // Resposta enquanto processa:
  //   { status: 'processando', tentativas: 1, ... }
  //
  // Resposta ao concluir:
  //   { status: 'concluido', resultado: { total, valorTotal, capturaId } }
  //
  // Resposta em caso de erro:
  //   { status: 'erro', erro: 'mensagem', tentativas: 3 }

  app.get('/api/nfse/jobs/:id', autenticar, (req, res) => {
    const status = queue.status(req.params.id);

    if (!status) {
      return res.status(404).json({ erro: 'Job não encontrado.' });
    }

    res.json(status);
  });

  // ── POST /api/nfse/capturar ────────────────────────────────────────────────
  // ✅ Agora assíncrono: retorna {jobId} imediatamente.
  //    O frontend deve fazer polling em GET /api/nfse/jobs/:id
  //
  // Body:
  //   { cnpj, tipo, dataInicio, dataFim, empresaId? }
  //
  // Resposta:
  //   202 Accepted — { jobId, status: 'pendente', mensagem: '...' }

  app.post('/api/nfse/capturar', autenticar, requireAdmin, (req, res) => {
    const { cnpj, tipo = 'ambas', dataInicio, dataFim, empresaId } = req.body;

    // Validação básica antes de enfileirar
    if (!cnpj || !dataInicio || !dataFim) {
      return res.status(400).json({
        erro: 'Campos obrigatórios: cnpj, dataInicio, dataFim.'
      });
    }

    try {
      const jobId = queue.enfileirar({ cnpj, tipo, dataInicio, dataFim, empresaId });

      res.status(202).json({
        jobId,
        status:   'pendente',
        mensagem: 'Captura enfileirada. Acompanhe o progresso em GET /api/nfse/jobs/' + jobId,
        pollingUrl: `/api/nfse/jobs/${jobId}`,
      });
    } catch (err) {
      res.status(400).json({ erro: err.message });
    }
  });

  // ── POST /api/nfse/capturar-batch ─────────────────────────────────────────
  // ✅ Novo: enfileira múltiplas empresas de uma vez.
  //
  // Body:
  //   {
  //     dataInicio: 'DD/MM/AAAA',
  //     dataFim:    'DD/MM/AAAA',
  //     tipo:       'ambas',         // opcional
  //     empresas: [
  //       { cnpj: '...', empresaId: 1 },
  //       { cnpj: '...', empresaId: 2 },
  //     ]
  //   }
  //
  // Resposta:
  //   202 Accepted — { total, jobs: [{ cnpj, jobId }] }

  app.post('/api/nfse/capturar-batch', autenticar, requireAdmin, (req, res) => {
    const { dataInicio, dataFim, tipo = 'ambas', empresas } = req.body;

    if (!dataInicio || !dataFim) {
      return res.status(400).json({ erro: 'dataInicio e dataFim são obrigatórios.' });
    }

    if (!Array.isArray(empresas) || empresas.length === 0) {
      return res.status(400).json({ erro: 'O campo empresas deve ser um array não vazio.' });
    }

    if (empresas.length > 50) {
      return res.status(400).json({ erro: 'Máximo de 50 empresas por batch.' });
    }

    const erros = [];
    const jobsCriados = [];

    for (const empresa of empresas) {
      if (!empresa.cnpj) {
        erros.push({ empresa, erro: 'CNPJ ausente.' });
        continue;
      }

      try {
        const jobId = queue.enfileirar({
          cnpj:       empresa.cnpj,
          tipo,
          dataInicio,
          dataFim,
          empresaId:  empresa.empresaId || null,
        });
        jobsCriados.push({ cnpj: empresa.cnpj, empresaId: empresa.empresaId, jobId });
      } catch (err) {
        erros.push({ cnpj: empresa.cnpj, erro: err.message });
      }
    }

    res.status(202).json({
      total:       jobsCriados.length,
      erros:       erros.length,
      jobs:        jobsCriados,
      detalhesErros: erros.length > 0 ? erros : undefined,
      mensagem:    `${jobsCriados.length} job(s) enfileirado(s). Acompanhe em GET /api/nfse/jobs`,
    });
  });

  // ── POST /api/nfse/gerar-link/:id ─────────────────────────────────────────
  // ✅ Tokens agora persistidos no banco (não somem em restarts).
  //    Interface idêntica à v3.

  app.post('/api/nfse/gerar-link/:id', autenticar, requireAdmin, (req, res) => {
    const id = req.params.id;
    const caminhoZip = stmtBuscarCapturaOuJob(id);
    
    if (!caminhoZip) {
      return res.status(404).json({ erro: 'Captura ou Job não encontrado, ou não possui arquivo ZIP.' });
    }

    try {
      const token = tokens.gerar(id, 60); 
      res.json({ url: `/api/nfse/arquivo/${token}` });
    } catch (err) {
      console.error('[NFS-e] Erro ao gerar token:', err.message);
      res.status(500).json({ erro: 'Erro ao gerar link de download.' });
    }
  });

  // ── GET /api/nfse/arquivo/:token ───────────────────────────────────────────
  // ✅ Valida e consome o token persistente, serve o arquivo ZIP.
  //    Sem mudança de interface — o frontend não precisa ser alterado.

  app.get('/api/nfse/arquivo/:token', (req, res) => {
    const id = tokens.consumir(req.params.token);

    if (!id) {
      return res.status(403).json({
        erro: 'Token inválido, expirado ou já utilizado. Gere um novo link.'
      });
    }

    const caminhoZip = stmtBuscarCapturaOuJob(id);
    if (!caminhoZip) {
      return res.status(404).json({ erro: 'Arquivo não registrado no banco de dados.' });
    }

    const caminhoAbsoluto = path.isAbsolute(caminhoZip) 
      ? caminhoZip 
      : path.join(process.cwd(), caminhoZip);

    if (!fs.existsSync(caminhoAbsoluto)) {
      console.error(`[NFS-e] Arquivo não encontrado fisicamente: ${caminhoAbsoluto}`);
      return res.status(404).json({ erro: 'O arquivo ZIP não foi encontrado no disco do servidor.' });
    }

    res.download(caminhoAbsoluto, path.basename(caminhoAbsoluto), (err) => {
      if (err) {
        console.error(`[NFS-e] Erro ao servir arquivo ${caminhoAbsoluto}:`, err.message);
      }
    });
  });

  // ── GET /api/nfse/download/:id (legada) ───────────────────────────────────
  // Mantida para compatibilidade com integrações existentes.
  // Requer JWT via query string ?token=

  app.get('/api/nfse/download/:id', autenticar, requireAdmin, (req, res) => {
    const capturaId = parseInt(req.params.id, 10);
    const captura   = stmtBuscarCaptura.get(capturaId);

    if (!captura || !captura.arquivo_zip) {
      return res.status(404).json({ erro: 'Arquivo não encontrado.' });
    }

    const caminhoArquivo = path.resolve(captura.arquivo_zip);

    if (!fs.existsSync(caminhoArquivo)) {
      return res.status(404).json({ erro: 'Arquivo não encontrado no disco.' });
    }

    res.download(caminhoArquivo);
  });

  console.log('[NFS-e] Rotas v4 registradas.');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _formatarJob(row) {
  return {
    id:          row.id,
    status:      row.status,
    cnpj:        row.cnpj,
    tipo:        row.tipo,
    dataInicio:  row.data_inicio,
    dataFim:     row.data_fim,
    tentativas:  row.tentativas,
    resultado:   row.resultado ? JSON.parse(row.resultado) : null,
    erro:        row.erro,
    criadoEm:    row.criado_em,
    iniciadoEm:  row.iniciado_em,
    concluidoEm: row.concluido_em,
  };
}

module.exports = { criarRotasNfse };
