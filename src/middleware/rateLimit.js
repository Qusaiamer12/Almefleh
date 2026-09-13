'use strict';
/**
 * حد بسيط لعدد الطلبات لكل IP (نافذة منزلقة بالذاكرة).
 * الهدف مش الحماية من هجوم كبير - الهدف إنه خلل بالواجهة أو سكربت
 * طايش ما يستهلك موارد الخطة المجانية ويوقّف الخدمة عن باقي المستخدمين.
 * (حماية الدخول من التخمين منفصلة وبقاعدة البيانات: lib/loginGuard.js)
 */
const log = require('../lib/logger');

const WINDOW_MS = Number(process.env.RATE_WINDOW_MS || 60000);
const MAX_REQUESTS = Number(process.env.RATE_MAX || 300);
const MAX_TRACKED_IPS = 5000;

const hits = new Map(); // ip => {count, resetAt}

function rateLimit(req, res, next) {
  // ملاحظة: هذا الـ middleware مركّب على '/api'، فـ req.path بيجي بدون البادئة
  // (يعني '/health' مش '/api/health') - لازم نفحص المسار الكامل.
  if (req.originalUrl.split('?')[0].startsWith('/api/health')) return next(); // مراقبة UptimeRobot

  const key = req.ip || 'unknown';
  const now = Date.now();
  let entry = hits.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    hits.set(key, entry);
  }
  entry.count += 1;

  // تنظيف دوري بسيط: إذا كبرت الخريطة، احذف المنتهي
  if (hits.size > MAX_TRACKED_IPS) {
    for (const [ip, value] of hits) if (value.resetAt <= now) hits.delete(ip);
  }

  const remaining = Math.max(0, MAX_REQUESTS - entry.count);
  res.setHeader('X-RateLimit-Remaining', String(remaining));

  if (entry.count > MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    if (entry.count === MAX_REQUESTS + 1) {
      log.warn('تجاوز حد الطلبات', { ip: key, count: entry.count });
    }
    return res.status(429).json({ error: 'طلبات كتيرة بوقت قصير - استنّى شوي وجرّب كمان مرة' });
  }
  next();
}

/** للاختبارات */
function resetRateLimit() { hits.clear(); }

module.exports = { rateLimit, resetRateLimit };
