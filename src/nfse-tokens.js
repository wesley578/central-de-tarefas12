/**
 * nfse-tokens.js
 * Gerenciador de tokens de download temporários com persistência em SQLite.
 *
 * Substitui o Map em memória da v3 — os tokens sobrevivem a restarts do servidor.
 *
 * Uso:
 *   const tokens = new TokenManager(db);
 *   tokens.iniciar();                          // liga o cron de limpeza
 *   const token = tokens.gerar(capturaId);     // cria token (60s, uso único)
 *   const capturaId = tokens.consumir(token);  // valida e queima o token
 *   tokens.parar();                            // desliga o cron
 */

'use strict';

const { randomUUID } = require('crypto');

/** TTL padrão dos tokens em segundos */
const TOKEN_TTL_SEGUNDOS = 60;

/** Intervalo de limpeza automática em ms */
const LIMPEZA_INTERVALO_MS = 5 * 60 * 1000; // 5 min

class TokenManager {
  /**
   * @param {import('better-sqlite3').Database} db - instância do banco SQLite
   */
  constructor(db) {
    this._db = db;
    this._timer = null;
    this._prepareStatements();
  }

  /** Pré-compila os statements para máxima performance. */
  _prepareStatements() {
    this._stmtInserir = this._db.prepare(`
      INSERT INTO nfse_tokens (token, captura_id, expira_em)
      VALUES (?, ?, ?)
    `);

    this._stmtBuscar = this._db.prepare(`
      SELECT captura_id, usado, expira_em
      FROM nfse_tokens
      WHERE token = ?
    `);

    this._stmtMarcarUsado = this._db.prepare(`
      UPDATE nfse_tokens
      SET usado = 1
      WHERE token = ?
    `);

    this._stmtLimpar = this._db.prepare(`
      DELETE FROM nfse_tokens
      WHERE expira_em < datetime('now')
         OR usado = 1
    `);
  }

  /**
   * Gera um token temporário para download de um arquivo de captura.
   *
   * @param {number} capturaId - ID do registro na tabela `capturas_nfse`
   * @param {number} [ttlSegundos] - validade em segundos (padrão: 60)
   * @returns {string} token UUID gerado
   */
  gerar(capturaId, ttlSegundos = TOKEN_TTL_SEGUNDOS) {
    const token = randomUUID();
    const expiraEm = new Date(Date.now() + ttlSegundos * 1000).toISOString();

    this._stmtInserir.run(token, capturaId, expiraEm);

    console.log(`[NFS-e Tokens] Token gerado para captura #${capturaId} — expira em ${ttlSegundos}s`);
    return token;
  }

  /**
   * Valida e consome um token (uso único).
   *
   * @param {string} token
   * @returns {number|null} capturaId se válido, null caso contrário
   */
  consumir(token) {
    if (!token) return null;

    const row = this._stmtBuscar.get(token);

    if (!row) {
      console.warn(`[NFS-e Tokens] Token não encontrado: ${token}`);
      return null;
    }

    if (row.usado) {
      console.warn(`[NFS-e Tokens] Token já consumido: ${token}`);
      return null;
    }

    const agora = new Date();
    const expiraEm = new Date(row.expira_em);

    if (agora > expiraEm) {
      console.warn(`[NFS-e Tokens] Token expirado: ${token}`);
      return null;
    }

    // Marca como usado (transação atômica)
    this._stmtMarcarUsado.run(token);

    console.log(`[NFS-e Tokens] Token consumido para captura #${row.captura_id}`);
    return row.captura_id;
  }

  /**
   * Remove tokens expirados e já utilizados do banco.
   * Chamado automaticamente pelo cron interno.
   *
   * @returns {number} quantidade de tokens removidos
   */
  limpar() {
    const info = this._stmtLimpar.run();
    if (info.changes > 0) {
      console.log(`[NFS-e Tokens] Limpeza: ${info.changes} token(s) removido(s)`);
    }
    return info.changes;
  }

  /**
   * Inicia o cron de limpeza automática.
   * Chame uma vez ao inicializar o servidor.
   */
  iniciar() {
    if (this._timer) return; // já rodando
    this.limpar(); // limpeza imediata ao iniciar
    this._timer = setInterval(() => this.limpar(), LIMPEZA_INTERVALO_MS);
    this._timer.unref(); // não impede o processo de terminar
    console.log('[NFS-e Tokens] Cron de limpeza iniciado (intervalo: 5min)');
  }

  /** Para o cron de limpeza. Útil em testes e shutdown gracioso. */
  parar() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}

module.exports = { TokenManager };
