#!/usr/bin/env node
/**
 * scripts/migrate-to-pg.js
 *
 * Migra dados do SQLite para PostgreSQL.
 *
 * Uso:
 *   DATABASE_URL=postgresql://... node scripts/migrate-to-pg.js
 *
 * O que faz:
 *   1. Lê o schema do SQLite e recria as tabelas no PG
 *   2. Exporta todos os dados e importa no PG
 *   3. Ajusta sequences (auto-increment)
 */

'use strict';

require('dotenv').config();
const Database = require('better-sqlite3');
const { Pool } = require('pg');
const path = require('path');

const SQLITE_PATH = process.env.DB_PATH || path.join(__dirname, '../tarefas.db');
const PG_URL      = process.env.DATABASE_URL;

if (!PG_URL) {
  console.error('❌ DATABASE_URL não definida no .env');
  process.exit(1);
}

const sqlite = new Database(SQLITE_PATH, { readonly: true });
const pool   = new Pool({ connectionString: PG_URL, ssl: { rejectUnauthorized: false } });

// Tipos SQLite → PG
function traduzirTipo(sqliteType) {
  const t = (sqliteType || '').toUpperCase();
  if (t.includes('INT'))      return 'INTEGER';
  if (t.includes('TEXT') || t.includes('VARCHAR') || t.includes('CHAR')) return 'TEXT';
  if (t.includes('REAL') || t.includes('FLOAT') || t.includes('DOUBLE')) return 'REAL';
  if (t.includes('BLOB'))     return 'BYTEA';
  if (t.includes('BOOL'))     return 'BOOLEAN';
  return 'TEXT';
}

// Converte CREATE TABLE SQLite → PG
function traduzirCreateTable(sqliteCreate) {
  let s = sqliteCreate;

  // Remove IF NOT EXISTS opcional
  s = s.replace(/CREATE TABLE IF NOT EXISTS/gi, 'CREATE TABLE IF NOT EXISTS');

  // INTEGER PRIMARY KEY AUTOINCREMENT → SERIAL PRIMARY KEY
  s = s.replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
  s = s.replace(/INTEGER\s+PRIMARY\s+KEY/gi, 'SERIAL PRIMARY KEY');

  // datetime('now') → NOW()
  s = s.replace(/datetime\s*\(\s*'now'\s*(?:,\s*'localtime')?\s*\)/gi, 'NOW()');
  s = s.replace(/date\s*\(\s*'now'\s*(?:,\s*'localtime')?\s*\)/gi, 'CURRENT_DATE');

  // Adiciona IF NOT EXISTS se não tiver
  if (!/IF NOT EXISTS/i.test(s)) {
    s = s.replace(/CREATE TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ');
  }

  return s;
}

async function main() {
  const client = await pool.connect();

  try {
    console.log('🔌 Conectado ao PostgreSQL');
    console.log(`📂 Lendo SQLite: ${SQLITE_PATH}\n`);

    // Busca todas as tabelas do SQLite (exclui internas)
    const tabelas = sqlite.prepare(`
      SELECT name, sql FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all();

    console.log(`📋 Tabelas encontradas: ${tabelas.map(t => t.name).join(', ')}\n`);

    await client.query('BEGIN');

    for (const tabela of tabelas) {
      if (!tabela.sql) continue;

      // 1. Cria tabela no PG
      const createPG = traduzirCreateTable(tabela.sql);
      try {
        await client.query(createPG);
        console.log(`✅ Tabela criada: ${tabela.name}`);
      } catch (e) {
        console.log(`⚠️  Tabela ${tabela.name}: ${e.message.split('\n')[0]}`);
      }

      // 2. Busca dados do SQLite
      const rows = sqlite.prepare(`SELECT * FROM "${tabela.name}"`).all();
      if (rows.length === 0) {
        console.log(`   ↳ Vazia, pulando.`);
        continue;
      }

      // 3. Insere no PG
      const colunas = Object.keys(rows[0]);
      const placeholders = colunas.map((_, i) => `$${i + 1}`).join(', ');
      const insertSQL = `
        INSERT INTO "${tabela.name}" (${colunas.map(c => `"${c}"`).join(', ')})
        VALUES (${placeholders})
        ON CONFLICT DO NOTHING
      `;

      let inseridos = 0;
      for (const row of rows) {
        try {
          await client.query(insertSQL, colunas.map(c => row[c]));
          inseridos++;
        } catch (e) {
          console.warn(`   ⚠️  Linha ignorada: ${e.message.split('\n')[0]}`);
        }
      }
      console.log(`   ↳ ${inseridos}/${rows.length} linhas importadas`);
    }

    await client.query('COMMIT');
    console.log('\n✅ Dados migrados com sucesso!\n');

    // 4. Ajusta sequences (auto-increment)
    console.log('🔧 Ajustando sequences...');
    for (const tabela of tabelas) {
      try {
        await client.query(`
          SELECT setval(
            pg_get_serial_sequence('"${tabela.name}"', 'id'),
            COALESCE((SELECT MAX(id) FROM "${tabela.name}"), 0) + 1,
            false
          )
        `);
        console.log(`   ✅ Sequence de ${tabela.name} ajustada`);
      } catch (e) {
        // Tabela sem sequence (sem coluna id serial) — ignorar
      }
    }

    console.log('\n🎉 Migração concluída! Defina DATABASE_URL no Railway e faça o deploy.');

  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ Erro durante migração:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

main();
