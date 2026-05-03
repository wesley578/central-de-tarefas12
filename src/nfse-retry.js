/**
 * nfse-retry.js
 * Utilitário de retry com backoff exponencial + jitter.
 *
 * Uso:
 *   const result = await withRetry(() => captureNfse(...), {
 *     maxAttempts: 3,
 *     baseDelayMs: 5000,
 *     onRetry: (err, attempt) => console.log(`[Retry] tentativa ${attempt}`)
 *   });
 */

'use strict';

/**
 * Aguarda `ms` milissegundos.
 * @param {number} ms
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calcula o delay para a tentativa `attempt` com jitter aleatório.
 * Fórmula: baseDelay * 2^(attempt-1) + jitter (0–1000ms)
 *
 * Exemplo com baseDelay=5000:
 *   tentativa 1 → ~5s
 *   tentativa 2 → ~10s
 *   tentativa 3 → ~20s
 *
 * @param {number} attempt   - número da tentativa (começa em 1)
 * @param {number} baseDelay - delay base em ms
 * @param {number} maxDelay  - teto do delay em ms (padrão: 60s)
 */
function calcDelay(attempt, baseDelay, maxDelay = 60_000) {
  const exponential = baseDelay * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * 1000);
  return Math.min(exponential + jitter, maxDelay);
}

/**
 * Executa `fn` com retry automático em caso de erro.
 *
 * @template T
 * @param {() => Promise<T>} fn          - função assíncrona a executar
 * @param {object}           [opts]
 * @param {number}           [opts.maxAttempts=3]    - total de tentativas (incluindo a primeira)
 * @param {number}           [opts.baseDelayMs=5000] - delay base em ms entre tentativas
 * @param {number}           [opts.maxDelayMs=60000] - teto do delay em ms
 * @param {(err: Error, attempt: number, delayMs: number) => void} [opts.onRetry]
 *   Callback chamado antes de cada retry — ideal para logging.
 * @param {(err: Error) => boolean} [opts.shouldRetry]
 *   Função opcional que decide se deve tentar novamente.
 *   Por padrão, sempre retenta (exceto se o erro tiver `retry=false`).
 * @returns {Promise<T>}
 * @throws {Error} - lança o último erro após esgotar as tentativas
 */
async function withRetry(fn, opts = {}) {
  const {
    maxAttempts  = 3,
    baseDelayMs  = 5_000,
    maxDelayMs   = 60_000,
    onRetry      = null,
    shouldRetry  = (err) => err?.retry !== false,
  } = opts;

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;

      const isLastAttempt = attempt === maxAttempts;
      const canRetry = shouldRetry(err);

      if (isLastAttempt || !canRetry) {
        // Enriquece o erro com metadados de retry antes de relançar
        err.retryAttempts = attempt;
        err.retryExhausted = isLastAttempt;
        throw err;
      }

      const delayMs = calcDelay(attempt, baseDelayMs, maxDelayMs);

      if (onRetry) {
        try {
          onRetry(err, attempt, delayMs);
        } catch (_) {
          // Nunca deixar o callback de log quebrar o retry
        }
      }

      await sleep(delayMs);
    }
  }

  // Nunca chega aqui, mas garante tipagem correta
  throw lastError;
}

module.exports = { withRetry, sleep, calcDelay };
