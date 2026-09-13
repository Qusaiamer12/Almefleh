'use strict';
const log = require('../lib/logger');

/** تغليف دوال async عشان الأخطاء تروح للمعالج المركزي */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function notFound(_req, res) {
  res.status(404).json({ error: 'الصفحة أو العملية غير موجودة' });
}

// أخطاء قاعدة البيانات اللي سببها مخالفة قاعدة عمل - مش عطل بالسيرفر
const DB_RULE_ERRORS = {
  23505: 'القيمة موجودة مسبقاً (تكرار)',
  23503: 'ما بينفع تحذف/تعدّل - في بيانات مرتبطة',
  23514: 'بيانات غير صالحة للعملية المطلوبة',
  '22P02': 'قيمة غير صالحة بالطلب',
  '22003': 'الرقم أكبر من المسموح',
};

function errorHandler(err, req, res, _next) {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'صار خطأ غير متوقع';

  if (DB_RULE_ERRORS[err.code]) {
    message = DB_RULE_ERRORS[err.code];
    if (status >= 500) status = 400;
  }
  // رسائل الـ triggers تبعنا (RAISE EXCEPTION) مكتوبة بالعربي وموجّهة للمستخدم
  if (err.code === 'P0001') {
    message = err.message;
    if (status >= 500) status = 400;
  }

  if (status >= 500) {
    log.error('خطأ غير متوقع', {
      id: req.id, path: req.originalUrl, code: err.code,
      error: err.message, stack: err.stack?.split('\n').slice(0, 4).join(' | '),
    });
  }

  if (err.retryAfter) res.setHeader('Retry-After', String(err.retryAfter));

  res.status(status >= 500 ? 500 : status).json({
    error: status >= 500 ? 'صار خطأ بالسيرفر' : message,
    // معرّف الطلب بيساعد بتتبّع الخطأ بالسجلّات
    ...(status >= 500 ? { request_id: req.id } : {}),
    ...(err.field ? { field: err.field } : {}),
  });
}

module.exports = { asyncHandler, notFound, errorHandler };
