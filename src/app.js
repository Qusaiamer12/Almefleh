'use strict';
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('./config');
const db = require('./db');
const { loadUser } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/errors');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// رؤوس أمان أساسية
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
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

// شعار المفلح: بيستعمل logo.png إذا انحطّ بالفولدر، وإلا الرسمة المتجهة
const LOGO_PATH = require('fs').existsSync(path.join(__dirname, '..', 'public', 'assets', 'logo.png'))
  ? '/assets/logo.png' : '/assets/logo.svg';

app.get('/api/config', (req, res) => {
  res.json({
    app_name: config.appName,
    currency: config.currency,
    timezone: config.timezone,
    logo: LOGO_PATH,
    user: req.user || null,
  });
});

// ملفات الواجهة
const publicDir = path.join(__dirname, '..', 'public');
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
