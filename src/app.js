'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('./config');
const db = require('./db');
const { loadUser } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/errors');
const { requestContext } = require('./middleware/requestLog');
const { rateLimit } = require('./middleware/rateLimit');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(requestContext);
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));
app.use(cookieParser());
app.use('/api', rateLimit);

// رؤوس الأمان
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()');
  // سياسة محتوى صارمة: السكربتات من نفس الموقع بس (بتوقف أي حقن سكربت)
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    // خطوط جوجل: الملف من fonts.googleapis.com والخط نفسه من fonts.gstatic.com
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; '));
  if (config.env === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

/**
 * فحص المصدر للطلبات اللي بتغيّر بيانات.
 * كوكي SameSite=lax أصلاً بتمنع معظم هجمات CSRF، وهذا خط دفاع تاني.
 */
const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
app.use((req, res, next) => {
  if (!MUTATING.has(req.method)) return next();
  const origin = req.get('Origin');
  if (!origin) return next(); // طلب مش من متصفح (curl/سكربت) - الكوكي بتحميه
  let originHost;
  try { originHost = new URL(origin).host; } catch { originHost = null; }
  if (originHost && originHost !== req.get('Host')) {
    return res.status(403).json({ error: 'طلب من مصدر غير موثوق' });
  }
  next();
});

/** فحص الصحة - بيستعمله UptimeRobot لمنع سكون الخدمة */
app.get('/api/health', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ ok: true, app: config.appName, time: new Date().toISOString(), db: 'up' });
  } catch (err) {
    res.status(503).json({ ok: false, db: 'down', error: err.message });
  }
});

/** جاهزية الخدمة: القاعدة شغّالة + ما في ترحيلات معلّقة */
app.get('/api/health/ready', async (_req, res) => {
  try {
    const { pendingCount } = require('./lib/migrations');
    const pending = await pendingCount(db);
    if (pending > 0) {
      return res.status(503).json({ ok: false, reason: `في ${pending} ترحيل معلّق` });
    }
    res.json({ ok: true, migrations: 'محدّثة' });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

app.use(loadUser);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/items', require('./routes/items'));
app.use('/api/transactions', require('./routes/transactions').router);
app.use('/api/stock', require('./routes/stock'));
app.use('/api/statements', require('./routes/statements'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/users', require('./routes/users'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/proposals', require('./routes/proposals'));

app.get('/api/config', (req, res) => {
  res.json({
    app_name: config.appName,
    currency: config.currency,
    timezone: config.timezone,
    user: req.user || null,
  });
});

// ملفات الواجهة
const publicDir = path.join(__dirname, '..', 'public');

/**
 * شعار المفلح على رابط واحد ثابت: /assets/logo
 *
 * بيقدّم logo.png إذا انحطّ بالفولدر، وإلا الرسمة المتجهة logo.svg.
 * الفحص بيصير مع كل طلب مش وقت الإقلاع، فحط الشعار ما بده إعادة تشغيل.
 * ولأنه الرابط واحد، أيقونة التبويب وشعار الواجهة بيتغيّروا مع بعض.
 */
const LOGO_CANDIDATES = ['logo.png', 'logo.svg'];
app.get('/assets/logo', (_req, res, next) => {
  for (const name of LOGO_CANDIDATES) {
    const file = path.join(publicDir, 'assets', name);
    if (fs.existsSync(file)) return res.sendFile(file);
  }
  next();
});

app.use(express.static(publicDir, { extensions: ['html'] }));

// صفحات الواجهة (تطبيق صفحة واحدة)
const PAGES = ['/admin', '/record', '/overview', '/customer', '/login'];
for (const page of PAGES) {
  app.get(page, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  app.get(`${page}/*`, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
}
app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

app.use('/api', notFound);
app.use(errorHandler);

module.exports = app;
