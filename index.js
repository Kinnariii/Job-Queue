// src/db/index.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL error:', err);
});

/**
 * Run a query against the database
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 */
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  console.log(`[DB] query="${text.slice(0, 60)}..." duration=${duration}ms rows=${res.rowCount}`);
  return res;
}

/**
 * Initialize the database schema
 * Creates the jobs table if it doesn't exist
 */
async function initSchema() {
  const sql = `
    CREATE TABLE IF NOT EXISTS jobs (
      id          UUID PRIMARY KEY,
      type        VARCHAR(100) NOT NULL,
      payload     JSONB NOT NULL DEFAULT '{}',
      status      VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'success', 'failed')),
      attempts    INT NOT NULL DEFAULT 0,
      max_retries INT NOT NULL DEFAULT 3,
      result      JSONB,
      error       TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
  `;
  await pool.query(sql);
  console.log('[DB] Schema initialized');
}

module.exports = { query, initSchema, pool };
