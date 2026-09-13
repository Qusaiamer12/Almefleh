'use strict';
/**
 * حماية تسجيل الدخول من التخمين المتكرّر (brute force).
 *
 * السياسة:
 *   - ٥ محاولات فاشلة لنفس اليوزر خلال ١٥ دقيقة  => قفل الحساب ١٥ دقيقة
 *   - ٣٠ محاولة فاشلة من نفس الـ IP خلال ١٥ دقيقة => حظر الـ IP ١٥ دقيقة
 *   - أي دخول ناجح بيصفّر عدّاد اليوزر
 *
 * المحاولات بتنحفظ بقاعدة البيانات مش بالذاكرة، عشان تضل شغّالة
 * حتى لو الخدمة رجعت تشتغل (Render بتعيد التشغيل كتير بالخطة المجانية).
 */

const WINDOW_MINUTES = 15;
const MAX_USER_FAILURES = 5;
const MAX_IP_FAILURES = 30;
const LOCK_MINUTES = 15;

class TooManyAttempts extends Error {
  constructor(message, retryAfterSeconds) {
    super(message);
    this.name = 'TooManyAttempts';
    this.status = 429;
    this.retryAfter = retryAfterSeconds;
  }
}

/** بيرمي خطأ 429 إذا اليوزر أو الـ IP متجاوز الحد */
async function assertLoginAllowed(db, username, ip) {
  const { rows } = await db.query(
    `SELECT
       (SELECT locked_until FROM users WHERE lower(btrim(username)) = lower(btrim($1))) AS locked_until,
       (SELECT COUNT(*) FROM login_attempts
        WHERE lower(username) = lower(btrim($1))
          AND success = FALSE
          AND created_at > now() - ($3 || ' minutes')::interval
          AND created_at > COALESCE(
            (SELECT max(created_at) FROM login_attempts
             WHERE lower(username) = lower(btrim($1)) AND success = TRUE),
            '-infinity'::timestamptz)
       )::int AS user_failures,
       (SELECT COUNT(*) FROM login_attempts
        WHERE ip = $2 AND success = FALSE
          AND created_at > now() - ($3 || ' minutes')::interval)::int AS ip_failures`,
    [username, ip || null, String(WINDOW_MINUTES)],
  );

  const row = rows[0];

  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    const seconds = Math.ceil((new Date(row.locked_until) - Date.now()) / 1000);
    throw new TooManyAttempts(
      `الحساب متوقّف مؤقتاً بسبب محاولات دخول كتيرة. جرّب بعد ${Math.ceil(seconds / 60)} دقيقة.`,
      seconds,
    );
  }

  if (row.ip_failures >= MAX_IP_FAILURES) {
    throw new TooManyAttempts(
      `محاولات دخول كتيرة من هذا الجهاز. جرّب بعد ${LOCK_MINUTES} دقيقة.`,
      LOCK_MINUTES * 60,
    );
  }

  return { userFailures: row.user_failures };
}

/** تسجيل نتيجة المحاولة، وقفل الحساب إذا تجاوز الحد */
async function recordAttempt(db, { username, ip, success }) {
  await db.query(
    'INSERT INTO login_attempts (username, ip, success) VALUES ($1,$2,$3)',
    [String(username).slice(0, 120), ip || null, success],
  );

  if (success) {
    await db.query(
      `UPDATE users SET locked_until = NULL
       WHERE lower(btrim(username)) = lower(btrim($1)) AND locked_until IS NOT NULL`,
      [username],
    );
    return { locked: false };
  }

  // عدّ الفشل من بعد آخر دخول ناجح
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS failures FROM login_attempts
     WHERE lower(username) = lower(btrim($1))
       AND success = FALSE
       AND created_at > now() - ($2 || ' minutes')::interval
       AND created_at > COALESCE(
         (SELECT max(created_at) FROM login_attempts
          WHERE lower(username) = lower(btrim($1)) AND success = TRUE),
         '-infinity'::timestamptz)`,
    [username, String(WINDOW_MINUTES)],
  );

  if (rows[0].failures >= MAX_USER_FAILURES) {
    await db.query(
      `UPDATE users SET locked_until = now() + ($2 || ' minutes')::interval
       WHERE lower(btrim(username)) = lower(btrim($1))`,
      [username, String(LOCK_MINUTES)],
    );
    return { locked: true, failures: rows[0].failures };
  }
  return {
    locked: false,
    failures: rows[0].failures,
    remaining: MAX_USER_FAILURES - rows[0].failures,
  };
}

/** تنظيف السجلات القديمة (بينده من مهمة دورية) */
async function pruneAttempts(db, days = 30) {
  const { rowCount } = await db.query(
    `DELETE FROM login_attempts WHERE created_at < now() - ($1 || ' days')::interval`,
    [String(days)],
  );
  return rowCount;
}

module.exports = {
  assertLoginAllowed, recordAttempt, pruneAttempts, TooManyAttempts,
  MAX_USER_FAILURES, LOCK_MINUTES,
};
