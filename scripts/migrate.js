#!/usr/bin/env node
'use strict';
/** تطبيق ترحيلات قاعدة البيانات (غلاف سطر أوامر) */
const db = require('../src/db');
const { migrate } = require('../src/lib/migrations');

(async () => {
  console.log('الترحيل...');
  await db.waitForDatabase();
  const { applied, skipped } = await migrate(db);
  if (applied.length === 0) console.log(`\u2714 قاعدة البيانات محدّثة (${skipped} ترحيل مطبّق أصلاً)`);
  else console.log(`\u2714 انطبّق ${applied.length} ترحيل جديد`);
  await db.pool.end();
})().catch((err) => {
  console.error('\u2716', err.message);
  process.exit(1);
});
