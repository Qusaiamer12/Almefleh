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

const log = require('./lib/logger');

// خطأ بعميل خامل ما بيوقّف التطبيق - الـ pool بيستبدله لحاله
pool.on('error', (err) => log.error('خطأ باتصال قاعدة البيانات', { error: err.message }));

const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS || 500);

async function query(text, params) {
  const started = process.hrtime.bigint();
  try {
    const result = await pool.query(text, params);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (ms > SLOW_QUERY_MS) {
      log.warn('استعلام بطيء', { ms: Math.round(ms), sql: text.replace(/\s+/g, ' ').slice(0, 160) });
    }
    return result;
  } catch (err) {
    log.error('فشل استعلام', {
      error: err.message,
      code: err.code,
      sql: text.replace(/\s+/g, ' ').slice(0, 160),
    });
    throw err;
  }
}

/**
 * انتظار جاهزية قاعدة البيانات مع إعادة محاولة تصاعدية.
 * Supabase بالخطة المجانية ممكن تاخد وقت تصحى، وRender بتشغّل الخدمة قبلها.
 */
async function waitForDatabase({ attempts = 8, baseDelayMs = 500 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      if (attempt > 1) log.info('قاعدة البيانات جاهزة', { attempt });
      return true;
    } catch (err) {
      if (attempt === attempts) {
        log.error('ما قدرنا نوصل لقاعدة البيانات', { attempts, error: err.message });
        throw err;
      }
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), 10000);
      log.warn('قاعدة البيانات مش جاهزة - إعادة محاولة', { attempt, delay_ms: delay });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return false;
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

module.exports = { pool, query, withTransaction, waitForDatabase };
