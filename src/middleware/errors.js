'use strict';

/** تغليف دوال async عشان الأخطاء تروح للمعالج المركزي */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function notFound(_req, res) {
  res.status(404).json({ error: 'الصفحة أو العملية غير موجودة' });
}

function errorHandler(err, _req, res, _next) {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[error]', err);

  // رسائل أوضح لأخطاء قاعدة البيانات الشائعة
  let message = err.message || 'صار خطأ غير متوقع';
  if (err.code === '23505') message = 'القيمة موجودة مسبقاً (تكرار)';
  if (err.code === '23503') message = 'ما بينفع تحذف/تعدّل - في بيانات مرتبطة';
  if (err.code === '23514') message = 'بيانات غير صالحة للعملية المطلوبة';

  res.status(status >= 500 ? 500 : status).json({
    error: status >= 500 ? 'صار خطأ بالسيرفر' : message,
  });
}

module.exports = { asyncHandler, notFound, errorHandler };
