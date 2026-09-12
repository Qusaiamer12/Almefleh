'use strict';
const config = require('./config');
const app = require('./app');
const db = require('./db');

const server = app.listen(config.port, () => {
  console.log(`[${config.appName}] شغّال على المنفذ ${config.port} (${config.env})`);
  console.log(`[timezone] ${config.timezone} | بداية الأسبوع: السبت`);
});

// النسخ الاحتياطي الدوري
if (config.backup.enabled) {
  const { scheduleBackups } = require('./jobs/backup');
  scheduleBackups();
}

async function shutdown(signal) {
  console.log(`\n[${signal}] جاري الإغلاق...`);
  server.close(() => {
    db.pool.end().then(() => process.exit(0)).catch(() => process.exit(1));
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
