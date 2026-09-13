'use strict';
/**
 * استرجاع نسخة احتياطية.
 *
 *   node scripts/restore.js <ملف.json> --check      فحص الملف بدون تغيير شي
 *   node scripts/restore.js <ملف.json> --yes        استرجاع فعلي (بيمسح البيانات الحالية)
 *
 * الاسترجاع كله بـ transaction وحدة: إذا فشل بأي خطوة، القاعدة بترجع
 * لحالتها الأصلية وما بتضل نص مليانة.
 */
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const { verifyDump, TABLES } = require('../src/jobs/backup');

/** الأعمدة الموجودة فعلياً بالجدول - عشان نتعامل مع نسخ من إصدار أقدم */
async function tableColumns(client, table) {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return new Set(rows.map((r) => r.column_name));
}

async function restore(filePath, { dryRun = true, log = console.log } = {}) {
  const raw = fs.readFileSync(filePath, 'utf8');
  let dump;
  try {
    dump = JSON.parse(raw);
  } catch (err) {
    throw new Error(`الملف مش JSON صالح: ${err.message}`);
  }

  const problems = verifyDump(dump);
  if (problems.length) {
    throw new Error(`النسخة ما عبرت الفحص:\n  - ${problems.join('\n  - ')}`);
  }

  log(`✔ النسخة سليمة (${dump.meta.generated_at})`);
  log('  المحتوى: ' + Object.entries(dump.meta.row_counts)
    .filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join('، '));

  if (dryRun) {
    log('\n(فحص فقط - ما تغيّر شي. للاسترجاع الفعلي ضيف --yes)');
    return { checked: true, restored: false, counts: dump.meta.row_counts };
  }

  const restored = {};
  await db.withTransaction(async (client) => {
    // الترتيب معكوس للمسح (الأبناء قبل الآباء)
    const order = TABLES.filter((t) => t in dump.data);
    for (const table of [...order].reverse()) {
      // سجل التدقيق محمي بـ trigger - نوقفه مؤقتاً داخل هالـ transaction
      if (table === 'audit_log') await client.query('ALTER TABLE audit_log DISABLE TRIGGER USER');
      await client.query(`DELETE FROM ${table}`);
    }

    for (const table of order) {
      const rows = dump.data[table];
      if (!rows?.length) { restored[table] = 0; continue; }

      const existingColumns = await tableColumns(client, table);
      const columns = Object.keys(rows[0]).filter((c) => existingColumns.has(c));
      if (columns.length === 0) throw new Error(`جدول ${table}: ما في أعمدة مطابقة`);

      const quoted = columns.map((c) => `"${c}"`).join(', ');
      // إدخال على دفعات (٥٠٠ سطر بالمرة) عشان ما نتجاوز حدود المعاملات
      const BATCH = 500;
      for (let start = 0; start < rows.length; start += BATCH) {
        const batch = rows.slice(start, start + BATCH);
        const values = [];
        const placeholders = batch.map((row, rowIndex) => {
          const slots = columns.map((column, columnIndex) => {
            values.push(normalize(row[column]));
            return `$${rowIndex * columns.length + columnIndex + 1}`;
          });
          return `(${slots.join(', ')})`;
        });
        await client.query(
          `INSERT INTO ${table} (${quoted}) VALUES ${placeholders.join(', ')}`, values,
        );
      }
      restored[table] = rows.length;
      log(`  ✔ ${table}: ${rows.length} سطر`);
    }

    await client.query('ALTER TABLE audit_log ENABLE TRIGGER USER');

    // ضبط العدّادات (sequences) عشان الإدخالات الجديدة ما تصطدم
    const { rows: sequences } = await client.query(
      `SELECT c.relname AS seq, t.relname AS table_name, a.attname AS column_name
       FROM pg_class c
       JOIN pg_depend d ON d.objid = c.oid
       JOIN pg_class t ON t.oid = d.refobjid
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
       WHERE c.relkind = 'S'`,
    );
    for (const s of sequences) {
      await client.query(
        `SELECT setval($1, COALESCE((SELECT MAX("${s.column_name}") FROM "${s.table_name}"), 0) + 1, false)`,
        [s.seq],
      );
    }
    log(`  ✔ ${sequences.length} عدّاد انضبط`);
  });

  return { checked: true, restored: true, counts: restored };
}

/** pg بترجّع التواريخ ككائنات Date والـ jsonb ككائنات - بنرجّعها لصيغتها */
function normalize(value) {
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    return JSON.stringify(value);
  }
  return value;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const confirmed = args.includes('--yes');

  if (!file) {
    console.error('الاستعمال: node scripts/restore.js <ملف.json> [--check | --yes]');
    process.exit(1);
  }
  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) {
    console.error(`✖ الملف مش موجود: ${filePath}`);
    process.exit(1);
  }

  if (confirmed) {
    console.log('⚠ رح ينمسح كل المحتوى الحالي ويتبدّل بمحتوى النسخة.\n');
  }

  restore(filePath, { dryRun: !confirmed })
    .then((result) => {
      if (result.restored) console.log('\n✔ تم الاسترجاع بنجاح');
      return db.pool.end();
    })
    .catch((err) => {
      console.error('\n✖', err.message);
      process.exit(1);
    });
}

module.exports = { restore };
