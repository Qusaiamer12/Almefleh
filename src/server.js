'use strict';
const config = require('./config');
const log = require('./lib/logger');
const db = require('./db');

/**
 * بدء التشغيل:
 *   ١) ننتظر قاعدة البيانات تجهز (مع إعادة محاولة)
 *   ٢) نتأكد إنه المخطّط محدّث (ترحيلات مطبّقة)
 *   ٣) نشغّل الخدمة والمهام الدورية
 */
async function start() {
  await db.waitForDatabase();

  const { pendingCount } = require('./lib/migrations');
  const pending = await pendingCount(db);
  if (pending > 0) {
    if (String(process.env.AUTO_MIGRATE || 'false').toLowerCase() === 'true') {
      log.warn('في ترحيلات معلّقة - جاري تطبيقها', { pending });
      const { migrate } = require('./lib/migrations');
      await migrate(db, { log: (m) => log.info(m.trim()) });
    } else {
      log.error('في ترحيلات معلّقة - شغّل npm run migrate قبل التشغيل', { pending });
      process.exit(1);
    }
  }

  const app = require('./app');
  const server = app.listen(config.port, () => {
    log.info(`${config.appName} شغّال`, {
      port: config.port, env: config.env, timezone: config.timezone,
    });
  });
  server.headersTimeout = 20000;
  server.requestTimeout = 30000;

  // فشل الربط بالمنفذ = فشل إقلاع، لازم يخرج بكود خطأ مش نجاح
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log.error(`المنفذ ${config.port} مستعمل أصلاً - في نسخة تانية شغّالة؟`);
    } else if (err.code === 'EACCES') {
      log.error(`ما في صلاحية للمنفذ ${config.port}`);
    } else {
      log.error('فشل ربط المنفذ', { error: err.message, code: err.code });
    }
    // الخروج الفوري بيقطع الكتابة على stdout لما تكون أنبوب (pipe)،
    // فبنأجّله tick واحد عشان الرسالة توصل فعلاً
    setImmediate(() => process.exit(1));
  });

  if (config.backup.enabled) {
    require('./jobs/backup').scheduleBackups();
  }
  require('./jobs/maintenance').scheduleMaintenance();

  setupShutdown(server);
  return server;
}

/** إغلاق مرتّب: نوقف استقبال الطلبات، نخلّص الشغل الجاري، وبعدين نسكّر القاعدة */
function setupShutdown(server) {
  let shuttingDown = false;

  const shutdown = async (signal, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('جاري الإغلاق', { signal });

    const forceExit = setTimeout(() => {
      log.error('الإغلاق تأخّر - خروج إجباري');
      process.exit(exitCode || 1);
    }, 15000);
    forceExit.unref();

    server.close(async () => {
      try { await db.pool.end(); } catch { /* انقفل أصلاً */ }
      log.info('انقفل بأمان');
      process.exit(exitCode);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // خطأ غير ملتقط: نسجّله ونخرج بشكل مرتّب (Render بتعيد التشغيل)
  process.on('uncaughtException', (err) => {
    log.error('خطأ غير ملتقط', { error: err.message, stack: err.stack });
    shutdown('uncaughtException', 1);
  });
  process.on('unhandledRejection', (reason) => {
    log.error('وعد مرفوض بدون معالجة', {
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}

start().catch((err) => {
  log.error('فشل بدء التشغيل', { error: err.message, stack: err.stack });
  process.exit(1);
});
