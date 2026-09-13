'use strict';
/**
 * نظام ترحيل قاعدة البيانات.
 *
 * - كل ملف بـ db/migrations بينطبّق مرّة وحدة بس، بالترتيب، وجوّا transaction لحاله.
 * - بينحفظ بصمة (checksum) لكل ملف: إذا حدا عدّل ملف ترحيل مطبّق أصلاً، بيوقف فوراً
 *   بدل ما يخرب البيانات بصمت.
 * - قفل استشاري (advisory lock) بيمنع نسختين من التطبيق يترحّلوا بنفس الوقت
 *   (Render ممكن يشغّل أكتر من instance وقت النشر).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'db', 'migrations');
const LOCK_KEY = 8410231; // رقم ثابت لقفل الترحيل

const checksum = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);

function loadMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const version = file.split('_')[0];
      if (!/^\d+$/.test(version)) {
        throw new Error(`اسم ملف الترحيل لازم يبلّش برقم: ${file}`);
      }
      return { version, file, sql, checksum: checksum(sql) };
    });
}

async function ensureTrackingTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      file        TEXT NOT NULL,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      duration_ms INTEGER
    )`);
}

/**
 * @returns {{applied: string[], skipped: number}}
 */
async function migrate(db, { log = console.log } = {}) {
  const migrations = loadMigrations();
  if (migrations.length === 0) throw new Error('ما في ملفات ترحيل بـ db/migrations');

  const client = await db.pool.connect();
  const applied = [];
  try {
    // قفل: أي نسخة تانية بتستنّى لحد ما نخلص
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await ensureTrackingTable(client);

    const { rows: done } = await client.query('SELECT version, file, checksum FROM schema_migrations');
    const doneMap = new Map(done.map((r) => [r.version, r]));

    // تحقق إنه ما حدا عدّل ترحيل مطبّق
    for (const m of migrations) {
      const previous = doneMap.get(m.version);
      if (previous && previous.checksum !== m.checksum) {
        throw new Error(
          `ملف الترحيل ${m.file} تعدّل بعد ما انطبّق (البصمة تغيّرت).\n` +
          'ما بينفع تعدّل ترحيل مطبّق - أنشئ ملف ترحيل جديد بدله.',
        );
      }
    }

    for (const m of migrations) {
      if (doneMap.has(m.version)) continue;
      const started = Date.now();
      try {
        await client.query('BEGIN');
        await client.query(m.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, file, checksum, duration_ms) VALUES ($1,$2,$3,$4)',
          [m.version, m.file, m.checksum, Date.now() - started],
        );
        await client.query('COMMIT');
        applied.push(m.file);
        log(`  ✔ ${m.file} (${Date.now() - started}ms)`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`فشل الترحيل ${m.file}: ${err.message}`);
      }
    }

    return { applied, skipped: migrations.length - applied.length };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

/** التحقق إنه ما في ترحيلات معلّقة - بتستعملها نقطة الجاهزية */
async function pendingCount(db) {
  const migrations = loadMigrations();
  const { rows } = await db.query(
    "SELECT version FROM schema_migrations",
  ).catch(() => ({ rows: null }));
  if (!rows) return migrations.length;
  const done = new Set(rows.map((r) => r.version));
  return migrations.filter((m) => !done.has(m.version)).length;
}

module.exports = { migrate, pendingCount, loadMigrations };
