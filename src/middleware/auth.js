'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

// بادئة __Host- بتمنع أي نطاق فرعي من يزرع كوكي جلسة (بتشتغل مع HTTPS بس)
const COOKIE_NAME = config.env === 'production' ? '__Host-almefleh_session' : 'almefleh_session';

/**
 * التوكن بيحمل ختم وقت بيانات الدخول (cv). إذا تغيّرت كلمة السر أو اليوزر،
 * الختم بيتغيّر وكل التوكنات القديمة بتصير غير صالحة فوراً.
 */
function signToken(user) {
  return jwt.sign(
    {
      uid: user.id,
      role: user.role,
      entity_id: user.entity_id ?? null,
      cv: user.credentials_changed_at ? new Date(user.credentials_changed_at).getTime() : 0,
    },
    config.jwtSecret,
    { expiresIn: `${config.sessionHours}h`, algorithm: 'HS256' },
  );
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production',
    path: '/',
    maxAge: config.sessionHours * 3600 * 1000,
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true, sameSite: 'lax', path: '/', secure: config.env === 'production',
  });
}

/** بيحمّل المستخدم من الكوكي (بدون منع الوصول) */
async function loadUser(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    const { rows } = await db.query(
      `SELECT u.id, u.username, u.display_name, u.role, u.entity_id, u.active,
              u.notifications_on, u.credentials_changed_at, u.locked_until,
              e.name AS entity_name
       FROM users u LEFT JOIN entities e ON e.id = u.entity_id
       WHERE u.id = $1`,
      [payload.uid],
    );
    const user = rows[0];
    if (!user || !user.active) return next();

    // الجلسة بتنتهي إذا تغيّرت بيانات الدخول بعد إصدار التوكن
    const credentialStamp = new Date(user.credentials_changed_at).getTime();
    if ((payload.cv || 0) < credentialStamp) {
      clearAuthCookie(res);
      return next();
    }
    // حساب متوقّف مؤقتاً => الجلسة موقوفة كمان
    if (user.locked_until && new Date(user.locked_until) > new Date()) return next();

    req.user = user;
  } catch { /* توكن منتهي أو غير صالح */ }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'لازم تسجّل دخول' });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'لازم تسجّل دخول' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'ما عندك صلاحية لهاي الصفحة' });
    }
    next();
  };
}

/** مين بيشوف الأرقام المالية: الأدمن + الاطّلاع + الزبون (بس حسابه هو) */
function canSeeMoney(user) {
  return user && (user.role === 'admin' || user.role === 'viewer' || user.role === 'customer');
}

/** إخفاء الأرقام المالية عن المسجّل (عبود) */
function redactTransaction(txn, user) {
  if (canSeeMoney(user)) return txn;
  const { unit_price, amount, price_pending, price_overridden, debt_delta, ...rest } = txn;
  return rest;
}

module.exports = {
  COOKIE_NAME, signToken, setAuthCookie, clearAuthCookie,
  loadUser, requireAuth, requireRole, canSeeMoney, redactTransaction,
};
