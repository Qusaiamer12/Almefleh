'use strict';
/** مهام صيانة دورية خفيفة */
const cron = require('node-cron');
const db = require('../db');
const config = require('../config');
const log = require('../lib/logger');
const { pruneAttempts } = require('../lib/loginGuard');

const NOTIFICATION_RETENTION_DAYS = Number(process.env.NOTIFICATION_RETENTION_DAYS || 120);
const LOGIN_ATTEMPT_RETENTION_DAYS = Number(process.env.LOGIN_ATTEMPT_RETENTION_DAYS || 30);

async function runMaintenance() {
  const attempts = await pruneAttempts(db, LOGIN_ATTEMPT_RETENTION_DAYS);

  // التنبيهات المقروءة القديمة بس - سجل التدقيق ما بينمسح أبداً
  const { rowCount: notifications } = await db.query(
    `DELETE FROM notifications
     WHERE read_at IS NOT NULL AND created_at < now() - ($1 || ' days')::interval`,
    [String(NOTIFICATION_RETENTION_DAYS)],
  );

  return { login_attempts: attempts, notifications };
}

function scheduleMaintenance() {
  // كل يوم الساعة ٣ الفجر بتوقيت المستودع
  cron.schedule('0 3 * * *', async () => {
    try {
      const result = await runMaintenance();
      log.info('صيانة دورية', result);
    } catch (err) {
      log.error('فشلت الصيانة الدورية', { error: err.message });
    }
  }, { timezone: config.timezone });
}

module.exports = { runMaintenance, scheduleMaintenance };
