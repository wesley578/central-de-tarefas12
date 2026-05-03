-- ============================================================
-- NFS-e v4 — Migration
-- Executa uma única vez para adicionar suporte a:
--   • Jobs assíncronos (captura não-bloqueante)
--   • Tokens de download persistentes (sobrevivem a restart)
--   • Fila batch com controle de concorrência
-- ============================================================

-- ------------------------------------------------------------
-- Tabela de jobs assíncronos
-- Cada chamada ao robô gera um job; o worker processa em bg.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nfse_jobs (
  id            TEXT    PRIMARY KEY,                -- UUID v4
  empresa_id    INTEGER,                            -- FK opcional para empresas
  cnpj          TEXT    NOT NULL,
  tipo          TEXT    NOT NULL DEFAULT 'ambas',   -- 'prestadas' | 'tomadas' | 'ambas'
  data_inicio   TEXT    NOT NULL,                   -- DD/MM/AAAA
  data_fim      TEXT    NOT NULL,                   -- DD/MM/AAAA
  status        TEXT    NOT NULL DEFAULT 'pendente',-- pendente | processando | concluido | erro
  tentativas    INTEGER NOT NULL DEFAULT 0,
  max_tentativas INTEGER NOT NULL DEFAULT 3,
  resultado     TEXT,   -- JSON: { total, valor_total, captura_id, ... }
  erro          TEXT,   -- mensagem de erro da última tentativa
  criado_em     TEXT    NOT NULL DEFAULT (datetime('now')),
  iniciado_em   TEXT,
  concluido_em  TEXT
);

CREATE INDEX IF NOT EXISTS idx_nfse_jobs_status    ON nfse_jobs(status);
CREATE INDEX IF NOT EXISTS idx_nfse_jobs_cnpj      ON nfse_jobs(cnpj);
CREATE INDEX IF NOT EXISTS idx_nfse_jobs_criado    ON nfse_jobs(criado_em);

-- ------------------------------------------------------------
-- Tokens de download persistentes
-- Substitui o Map em memória — sobrevive a restarts do server.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nfse_tokens (
  token       TEXT    PRIMARY KEY,           -- UUID v4
  captura_id  INTEGER NOT NULL,
  usado       INTEGER NOT NULL DEFAULT 0,    -- 0 = disponível, 1 = consumido
  expira_em   TEXT    NOT NULL,              -- ISO datetime
  criado_em   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_nfse_tokens_expira ON nfse_tokens(expira_em);
CREATE INDEX IF NOT EXISTS idx_nfse_tokens_usado  ON nfse_tokens(usado);
