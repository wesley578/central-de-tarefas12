/**
 * db.js — Camada de acesso ao banco dual-mode
 *
 * • Desenvolvimento (sem DATABASE_URL): usa better-sqlite3 (síncrono, zero config)
 * • Produção Railway (com DATABASE_URL):  usa PostgreSQL via pg (assíncrono)
 *
 * API exposta é compatível com better-sqlite3:
 *   db.prepare(sql).get(params)   → row | null
 *   db.prepare(sql).all(params)   → row[]
 *   db.prepare(sql).run(params)   → { changes, lastInsertRowid }
 *   db.exec(sql)                  → void
 *   db.pragma(str)                → void (no-op no PG)
 *   db.transaction(fn)            → fn wrapped em transação
 *
 * No modo PG as funções .get/.all/.run são ASSÍNCRONAS (retornam Promise).
 * Como todas as rotas já usam async/await, basta adicionar `await` antes
 * das chamadas ao banco.
 */

'use strict';

require('dotenv').config();

// ─── Modo SQLite (local) ──────────────────────────────────────────────────────
if (!process.env.DATABASE_URL) {
  const Database = require('better-sqlite3');
  const path     = require('path');
  const dbPath   = process.env.DB_PATH || path.join(__dirname, '../tarefas.db');
  const db       = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  module.exports = db;
  return;
}

// ─── Modo PostgreSQL (produção) ───────────────────────────────────────────────
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('[DB] Erro no pool PostgreSQL:', err.message);
});

// ─── Tradutores SQL: SQLite → PostgreSQL ─────────────────────────────────────

/**
 * Converte SQL SQLite para PostgreSQL:
 * - Troca placeholders ? por $1, $2...
 * - INSERT OR REPLACE → INSERT ... ON CONFLICT DO UPDATE
 * - datetime/date functions
 * - AUTOINCREMENT → SERIAL
 * - replace() aninhado → regexp_replace()
 */
function traduzirSQL(sql) {
  let s = sql;

  // AUTOINCREMENT
  s = s.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
  s = s.replace(/AUTOINCREMENT/gi, '');

  // INSERT OR REPLACE INTO tabela → INSERT INTO tabela ... ON CONFLICT DO UPDATE
  s = s.replace(/INSERT OR REPLACE INTO\s+(\w+)/gi, (_, tabela) => {
    return `INSERT INTO ${tabela}`;
  });

  // REPLACE INTO → INSERT INTO ... ON CONFLICT DO UPDATE
  s = s.replace(/REPLACE INTO\s+(\w+)/gi, (_, tabela) => {
    return `INSERT INTO ${tabela}`;
  });

  // datetime('now', 'localtime') / datetime('now') → NOW()
  s = s.replace(/datetime\s*\(\s*'now'\s*(?:,\s*'localtime')?\s*\)/gi, 'NOW()');

  // date('now', 'localtime') / date('now') → CURRENT_DATE
  s = s.replace(/date\s*\(\s*'now'\s*(?:,\s*'localtime')?\s*\)/gi, 'CURRENT_DATE');

  // replace(replace(replace(col,a,b),c,d),e,f) → regexp_replace(col, '[./-]', '', 'g')
  // Padrão específico para limpeza de CNPJ
  s = s.replace(
    /replace\s*\(\s*replace\s*\(\s*replace\s*\(\s*(\w+)\s*,\s*'\.'.*?'\-'\s*,\s*''\s*\)\s*\)/gi,
    (_, col) => `regexp_replace(${col}, '[.\\-/]', '', 'g')`
  );

  // Troca ? por $1, $2... (preserva ordem)
  let idx = 0;
  s = s.replace(/\?/g, () => `$${++idx}`);

  return s;
}

/**
 * Normaliza parâmetros: objeto nomeado (@campo) ou array posicional
 * Retorna sempre um array posicional para o pg.
 */
function normalizarParams(sql, params) {
  if (!params) return [];
  if (Array.isArray(params)) return params;
  if (typeof params === 'object') {
    // Extrai valores na ordem em que aparecem no SQL (@campo)
    const matches = [...sql.matchAll(/@(\w+)/g)].map(m => m[1]);
    if (matches.length > 0) return matches.map(k => params[k] ?? null);
    // Se não tem @campo, tenta pegar os valores na ordem de inserção
    return Object.values(params);
  }
  return [params];
}

/**
 * Detecta se um INSERT precisará de ON CONFLICT e gera a cláusula.
 * Heurística: se o SQL original tinha INSERT OR REPLACE, adiciona
 * ON CONFLICT (primeira coluna do INSERT ou coluna única conhecida).
 */
function adicionarOnConflict(sqlOriginal, sqlTraduzido) {
  if (!/INSERT OR REPLACE|REPLACE INTO/i.test(sqlOriginal)) return sqlTraduzido;

  // Extrai nome da tabela
  const tabMatch = sqlTraduzido.match(/INSERT INTO\s+(\w+)\s*\(([^)]+)\)/i);
  if (!tabMatch) return sqlTraduzido;

  const tabela  = tabMatch[1];
  const colunas = tabMatch[2].split(',').map(c => c.trim());
  const primeiraCol = colunas[0];

  // Gera SET col = EXCLUDED.col para todas exceto a primeira (chave)
  const setClauses = colunas.slice(1).map(c => `${c} = EXCLUDED.${c}`).join(', ');

  if (!setClauses) return sqlTraduzido;

  return `${sqlTraduzido} ON CONFLICT (${primeiraCol}) DO UPDATE SET ${setClauses}`;
}

// ─── Wrapper prepare() ───────────────────────────────────────────────────────

function prepare(sqlOriginal) {
  const sqlBase = traduzirSQL(sqlOriginal);

  return {
    /** Retorna primeira linha ou null */
    async get(...args) {
      const params = args.length === 1 && !Array.isArray(args[0]) ? args[0] : args[0];
      const values = normalizarParams(sqlOriginal, params);
      const { rows } = await pool.query(sqlBase, values);
      return rows[0] ?? null;
    },

    /** Retorna todas as linhas */
    async all(...args) {
      const params = args.length === 1 ? args[0] : args;
      const values = normalizarParams(sqlOriginal, params);
      const { rows } = await pool.query(sqlBase, values);
      return rows;
    },

    /** Executa DML e retorna { changes, lastInsertRowid } */
    async run(...args) {
      const params = args.length === 1 ? args[0] : args;
      const values = normalizarParams(sqlOriginal, params);
      const sqlFinal = adicionarOnConflict(sqlOriginal, sqlBase);

      // Adiciona RETURNING id para pegar lastInsertRowid
      const sqlReturning = /INSERT/i.test(sqlFinal) && !/RETURNING/i.test(sqlFinal)
        ? sqlFinal + ' RETURNING id'
        : sqlFinal;

      const result = await pool.query(sqlReturning, values);
      return {
        changes:          result.rowCount ?? 0,
        lastInsertRowid:  result.rows?.[0]?.id ?? null,
      };
    },
  };
}

// ─── exec() ──────────────────────────────────────────────────────────────────

async function exec(sql) {
  // Divide em statements separados por ; e executa sequencialmente
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const stmt of statements) {
    try {
      await pool.query(traduzirSQL(stmt));
    } catch (e) {
      // Ignora erros de "já existe" em migrações
      if (!e.message.includes('already exists') && !e.message.includes('duplicate column')) {
        console.error('[DB] Erro ao executar:', stmt.substring(0, 80), '—', e.message);
        throw e;
      }
    }
  }
}

// ─── transaction() ───────────────────────────────────────────────────────────

async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn({
      prepare: (sql) => {
        const sqlBase = traduzirSQL(sql);
        return {
          async get(...args) {
            const values = normalizarParams(sql, args[0]);
            const { rows } = await client.query(sqlBase, values);
            return rows[0] ?? null;
          },
          async all(...args) {
            const values = normalizarParams(sql, args[0]);
            const { rows } = await client.query(sqlBase, values);
            return rows;
          },
          async run(...args) {
            const values = normalizarParams(sql, args[0]);
            const sqlFinal = adicionarOnConflict(sql, sqlBase);
            const result = await client.query(sqlFinal, values);
            return { changes: result.rowCount ?? 0, lastInsertRowid: result.rows?.[0]?.id ?? null };
          },
        };
      },
    });
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ─── Exporta objeto compatível ────────────────────────────────────────────────

const db = {
  prepare,
  exec,
  transaction,
  pragma: () => {}, // no-op no PG
  pool,             // acesso direto ao pool quando necessário
  isPG: true,
};

module.exports = db;
