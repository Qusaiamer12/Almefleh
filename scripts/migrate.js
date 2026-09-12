'use strict';
/** تطبيق مخطط قاعدة البيانات */
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await db.query(sql);
  console.log('✔ تم تطبيق مخطط قاعدة البيانات');
  await db.pool.end();
})().catch((err) => {
  console.error('✖ فشل التطبيق:', err.message);
  process.exit(1);
});
