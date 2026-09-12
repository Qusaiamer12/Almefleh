'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

const COOKIE_NAME = 'almefleh_session';

function signToken(user) {
  return jwt.sign(
    { uid: user.id, role: user.role, entity_id: user.entity_id ?? null },
    config.jwtSecret,
    { expiresIn: `${config.sessionHours}h` },
  );
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production',
    maxAge: config.sessionHours * 3600 * 1000,
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: config.env === 'production' });
}

/** بيحمّل المستخدم من الكوكي (بدون منع الوصول) */
async function loadUser(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const { rows } = await db.query(
      `SELECT u.id, u.username, u.display_name, u.role, u.entity_id, u.active,
              u.notifications_on, e.name AS entity_name
       FROM users u LEFT JOIN entities e ON e.id = u.entity_id
       WHERE u.id = $1`,
      [payload.uid],
    );
    if (rows[0] && rows[0].active) req.user = rows[0];
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
