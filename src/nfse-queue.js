/**
 * nfse-queue.js
 * Fila de jobs assíncronos para o robô NFS-e.
 *
 * Resolve o problema da captura síncrona bloqueante:
 * em vez de segurar a conexão HTTP por minutos, o endpoint retorna
 * imediatamente um `job_id` e o worker processa em background.
 *
 * Funcionalidades:
 *  • Concorrência controlada (padrão: 2 instâncias do Puppeteer em paralelo)
 *  • Retry automático com backoff exponencial (via nfse-retry.js)
 *  • Estado persistido no SQLite (jobs sobrevivem a restarts)
 *  • Eventos: 'job:concluido', 'job:erro', 'job:iniciado'
 *  • Suporte a batch (múltiplas empresas de uma vez)
 *
 * Uso:
 *   const queue = new NfseQueue({ db, capturarNfse, maxConcorrencia: 2 });
 *   queue.iniciar();
 *
 *   const jobId = queue.enfileirar({ cnpj, tipo, dataInicio, dataFim, empresaId });
 *   const status = queue.status(jobId);
 */

'use strict';

const { randomUUID }  = require('crypto');
const { EventEmitter } = require('events');
const { withRetry }   = require('./nfse-retry');
const { registrarJobNotion, criarTicketErro } = require('./notion-integration');


/** Intervalo de polling do worker em ms (verifica se há jobs pendentes) */
const POLLING_INTERVALO_MS = 3_000;

class NfseQueue extends EventEmitter {
  /**
   * @param {object} opts
   * @param {import('better-sqlite3').Database} opts.db
   * @param {Function} opts.capturarNfse       - função do robô: (params) => Promise<resultado>
   * @param {number}   [opts.maxConcorrencia]  - máx. jobs simultâneos (padrão: 2)
   * @param {number}   [opts.maxTentativas]    - tentativas por job (padrão: 3)
   * @param {number}   [opts.baseDelayMs]      - delay base de retry em ms (padrão: 8000)
   */
  constructor({ db, capturarNfse, maxConcorrencia = 2, maxTentativas = 3, baseDelayMs = 8_000 }) {
    super();
    this._db             = db;
    this._capturarNfse   = capturarNfse;
    this._maxConcorrencia = maxConcorrencia;
    this._maxTentativas  = maxTentativas;
    this._baseDelayMs    = baseDelayMs;
    this._ativos         = 0;   // jobs em execução neste momento
    this._timer          = null;
    this._preparar();
  }

  // ─── Helpers de DB (compatível com SQLite síncrono e PG assíncrono) ──────────

  _preparar() {
    // Armazena apenas as strings SQL; as chamadas são feitas via _db.prepare(sql)
    this._sql = {
      inserir: `INSERT INTO nfse_jobs
        (id, empresa_id, cnpj, tipo, data_inicio, data_fim, status, max_tentativas)
        VALUES (@id, @empresa_id, @cnpj, @tipo, @data_inicio, @data_fim, 'pendente', @max_tentativas)`,
      buscarPendentes: `SELECT * FROM nfse_jobs WHERE status = 'pendente' ORDER BY criado_em ASC LIMIT ?`,
      buscarPorId:     `SELECT * FROM nfse_jobs WHERE id = ?`,
      iniciar:         `UPDATE nfse_jobs SET status = 'processando', tentativas = tentativas + 1, iniciado_em = datetime('now') WHERE id = ?`,
      concluir:        `UPDATE nfse_jobs SET status = 'concluido', resultado = ?, concluido_em = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      erro:            `UPDATE nfse_jobs SET status = ?, erro = ?, updated_at = datetime('now') WHERE id = ?`,
      reenfileirar:    `UPDATE nfse_jobs SET status = 'pendente' WHERE id = ?`,
      recuperar:       `UPDATE nfse_jobs SET status = 'pendente' WHERE status = 'processando'`,
    };
  }

  async _run(sql, params) {
    const stmt = this._db.prepare(sql);
    return await Promise.resolve(stmt.run(params));
  }

  async _get(sql, params) {
    const stmt = this._db.prepare(sql);
    return await Promise.resolve(stmt.get(params));
  }

  async _all(sql, params) {
    const stmt = this._db.prepare(sql);
    return await Promise.resolve(stmt.all(params));
  }

  // ─── API Pública ─────────────────────────────────────────────────────────────

  /**
   * Enfileira um novo job de captura.
   *
   * @param {object} params
   * @param {string}  params.cnpj
   * @param {string}  params.tipo        - 'prestadas' | 'tomadas' | 'ambas'
   * @param {string}  params.dataInicio  - DD/MM/AAAA
   * @param {string}  params.dataFim     - DD/MM/AAAA
   * @param {number}  [params.empresaId]
   * @returns {string} jobId (UUID)
   */
  enfileirar({ cnpj, tipo = 'ambas', dataInicio, dataFim, empresaId = null }) {
    this._validarParams({ cnpj, tipo, dataInicio, dataFim });

    const id = randomUUID();

    // run é fire-and-forget aqui — enfileirar retorna jobId imediatamente
    this._run(this._sql.inserir, {
      id,
      empresa_id:    empresaId,
      cnpj,
      tipo,
      data_inicio:   dataInicio,
      data_fim:      dataFim,
      max_tentativas: this._maxTentativas,
    }).catch(err => console.error('[NFS-e Queue] Erro ao inserir job:', err.message));

    console.log(`[NFS-e Queue] Job enfileirado: ${id} | CNPJ: ${cnpj} | ${dataInicio}→${dataFim}`);

    // Tenta processar imediatamente se houver slot disponível
    setImmediate(() => this._tick());

    return id;
  }

  /**
   * Enfileira múltiplos CNPJs de uma vez (batch).
   *
   * @param {Array<object>} lista - array de params (mesmo formato de `enfileirar`)
   * @returns {string[]} array de jobIds
   */
  enfileirarBatch(lista) {
    if (!Array.isArray(lista) || lista.length === 0) {
      throw new Error('Lista de batch não pode ser vazia.');
    }
    return lista.map((params) => this.enfileirar(params));
  }

  /**
   * Retorna o status atual de um job.
   *
   * @param {string} jobId
   * @returns {object|null}
   */
  async status(jobId) {
    const row = await this._get(this._sql.buscarPorId, jobId);
    if (!row) return null;

    return {
      id:           row.id,
      status:       row.status,
      cnpj:         row.cnpj,
      tipo:         row.tipo,
      dataInicio:   row.data_inicio,
      dataFim:      row.data_fim,
      tentativas:   row.tentativas,
      resultado:    row.resultado ? JSON.parse(row.resultado) : null,
      erro:         row.erro,
      criadoEm:     row.criado_em,
      iniciadoEm:   row.iniciado_em,
      concluidoEm:  row.concluido_em,
    };
  }

  /**
   * Inicia o worker de processamento.
   * Chame uma vez na inicialização do servidor.
   */
  iniciar() {
    if (this._timer) return;

    // Recupera jobs que ficaram "processando" antes de um restart
    const recuperados = null;
    this._run(this._sql.recuperar).then(r => {
      if (r && r.changes > 0) console.log(`[NFS-e Queue] ${r.changes} job(s) recuperado(s) após restart`);
    }).catch(() => {});

    this._timer = setInterval(() => this._tick(), POLLING_INTERVALO_MS);
    this._timer.unref();
    this._tick(); // verifica imediatamente
    console.log(`[NFS-e Queue] Worker iniciado (concorrência máx: ${this._maxConcorrencia})`);
  }

  /** Para o worker. Útil para testes e shutdown gracioso. */
  parar() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  // ─── Worker Interno ───────────────────────────────────────────────────────────

  /**
   * Verifica quantos slots livres existem e dispara jobs pendentes.
   * Chamado pelo timer e após cada enfileiramento.
   */
  async _tick() {
    const slots = this._maxConcorrencia - this._ativos;
    if (slots <= 0) return;

    const pendentes = await this._all(this._sql.buscarPendentes, slots);
    for (const job of pendentes) {
      this._processarJob(job); // fire-and-forget com controle interno
    }
  }

  /**
   * Processa um único job com retry automático.
   * @param {object} job - linha do banco nfse_jobs
   */
  async _processarJob(job) {
    this._ativos++;
    await this._run(this._sql.iniciar, job.id);
    this.emit('job:iniciado', { jobId: job.id, cnpj: job.cnpj });

    console.log(`[NFS-e Queue] Iniciando job ${job.id} | CNPJ: ${job.cnpj} (tentativa ${job.tentativas + 1}/${job.max_tentativas})`);

    try {
      const resultado = await withRetry(
        () => this._capturarNfse({
          cnpj:        job.cnpj,
          tipo:        job.tipo,
          dataInicio:  job.data_inicio,
          dataFim:     job.data_fim,
          empresaId:   job.empresa_id,
        }),
        {
          maxAttempts: job.max_tentativas,
          baseDelayMs: this._baseDelayMs,
          onRetry: (err, attempt, delayMs) => {
            const segundos = Math.round(delayMs / 1000);
            console.warn(
              `[NFS-e Queue] Job ${job.id} — erro na tentativa ${attempt}: ${err.message}. ` +
              `Retentando em ${segundos}s...`
            );
            // Atualiza contador de tentativas no banco para visibilidade
            await this._run(this._sql.iniciar, job.id);
          },
        }
      );

      await this._run(this._sql.concluir, [JSON.stringify(resultado), job.id]);

      // Notifica o Notion de forma assíncrona
      registrarJobNotion(job, resultado).catch(err => {
        console.warn(`[Notion] Falha ao registrar job ${job.id}: ${err.message}`);
      });

      console.log(`[NFS-e Queue] Job ${job.id} concluído: ${resultado.total} nota(s)`);
      this.emit('job:concluido', { jobId: job.id, resultado });


    } catch (err) {
      const esgotou = err.retryExhausted || job.tentativas + 1 >= job.max_tentativas;
      const novoStatus = esgotou ? 'erro' : 'pendente';

      if (esgotou) {
        await this._run(this._sql.erro, ['erro', err.message, job.id]);

        // Cria ticket de erro no Notion de forma assíncrona
        criarTicketErro(job, err).catch(e => {
          console.warn(`[Notion] Falha ao criar ticket para job ${job.id}: ${e.message}`);
        });

        console.error(`[NFS-e Queue] Job ${job.id} falhou definitivamente: ${err.message}`);
        this.emit('job:erro', { jobId: job.id, erro: err.message });

      } else {
        await this._run(this._sql.reenfileirar, job.id);
        console.warn(`[NFS-e Queue] Job ${job.id} reenfileirado para nova tentativa`);
      }

    } finally {
      this._ativos--;
      // Tenta pegar próximo job imediatamente
      setImmediate(() => this._tick());
    }
  }

  // ─── Validação ────────────────────────────────────────────────────────────────

  _validarParams({ cnpj, tipo, dataInicio, dataFim }) {
    if (!cnpj || cnpj.replace(/\D/g, '').length < 11) {
      throw new Error('CNPJ/CPF inválido.');
    }
    // Aceita formato simples ('prestadas') ou composto ('prestadas:lista')
    const tipoNota = tipo ? tipo.split(':')[0] : '';
    if (!['prestadas', 'tomadas', 'ambas'].includes(tipoNota)) {
      throw new Error('Tipo deve ser: prestadas, tomadas ou ambas.');
    }
    const regexData = /^\d{2}\/\d{2}\/\d{4}$/;
    if (!regexData.test(dataInicio) || !regexData.test(dataFim)) {
      throw new Error('Datas devem estar no formato DD/MM/AAAA.');
    }
  }

}

module.exports = { NfseQueue };
