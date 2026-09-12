'use strict';
const { Pool } = require('pg');
const config = require('./config');

// أرقام numeric بترجع كنصوص من pg - بنحوّلها لأرقام JS
const types = require('pg').types;
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v))); // numeric
types.setTypeParser(20,  (v) => (v === null ? null : parseInt(v, 10))); // bigint

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.dbSsl ? { rejectUnauthorized: false } : false,
  max: Number(process.env.DB_POOL_MAX || 8),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => console.error('[db] خطأ بالاتصال:', err.message));

async function query(text, params) {
  return pool.query(text, params);
}

/** تنفيذ مجموعة عمليات داخل transaction واحدة */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* تم الإغلاق */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
