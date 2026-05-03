-- ─────────────────────────────────────────────────────────────────────────────
-- migrations/nfse-notion.sql
-- Fase 1: colunas adicionais para rastreamento completo de jobs
-- Aplique com: sqlite3 seu_banco.db < migrations/nfse-notion.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- Adiciona colunas à tabela de jobs se ainda não existirem
-- (SQLite não suporta IF NOT EXISTS no ALTER TABLE — use scripts separados
--  ou verifique antes de rodar em produção)

ALTER TABLE nfse_jobs ADD COLUMN tentativas    INTEGER DEFAULT 0;
ALTER TABLE nfse_jobs ADD COLUMN duracao_ms    INTEGER DEFAULT 0;
ALTER TABLE nfse_jobs ADD COLUMN notas_total   INTEGER DEFAULT 0;
ALTER TABLE nfse_jobs ADD COLUMN notion_page_id TEXT;
ALTER TABLE nfse_jobs ADD COLUMN updated_at    TEXT DEFAULT (datetime('now'));

-- Índice para consultas por status (útil para o polling da fila)
CREATE INDEX IF NOT EXISTS idx_nfse_jobs_status
  ON nfse_jobs(status, updated_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Tabela de incidentes de downtime (preparação para Fase 2 — item 05)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nfse_incidentes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  detectado   TEXT    DEFAULT (datetime('now')),
  jobs_afet   INTEGER,          -- quantos jobs falharam na janela
  duracao_s   INTEGER,          -- estimativa de duração do downtime
  resolvido   INTEGER DEFAULT 0,
  notion_id   TEXT
);
