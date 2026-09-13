'use strict';
const crypto = require('crypto');
const log = require('../lib/logger');

const SLOW_REQUEST_MS = Number(process.env.SLOW_REQUEST_MS || 1500);

/**
 * معرّف فريد لكل طلب: بيظهر بالسجلّات وبرسالة الخطأ للمستخدم،
 * عشان لما قصي يقول "طلع خطأ" نقدر نلاقي السطر بالضبط.
 */
function requestContext(req, res, next) {
  req.id = crypto.randomBytes(6).toString('hex');
  res.setHeader('X-Request-Id', req.id);
  const started = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    const fields = {
      id: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Math.round(durationMs),
      user: req.user?.username,
    };
    if (res.statusCode >= 500) log.error('طلب فشل', fields);
    else if (res.statusCode >= 400) log.warn('طلب مرفوض', fields);
    else if (durationMs > SLOW_REQUEST_MS) log.warn('طلب بطيء', fields);
    else log.debug('طلب', fields);
  });

  next();
}

module.exports = { requestContext };
