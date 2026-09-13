'use strict';
const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../middleware/errors');
const { signToken, setAuthCookie, clearAuthCookie, requireAuth } = require('../middleware/auth');
const { hashPassword, verifyPassword, encryptSecret, validatePassword } = require('../lib/crypto');
const { logAudit } = require('../lib/audit');
const { validate } = require('../lib/validate');
const guard = require('../lib/loginGuard');

const router = express.Router();

const HOME_BY_ROLE = {
  admin: '/admin', recorder: '/record', viewer: '/overview', customer: '/customer',
};

const LOGIN_SCHEMA = {
  username: { type: 'string', required: true, maxLength: 120, label: 'اسم المستخدم' },
  password: { type: 'string', required: true, maxLength: 200, label: 'كلمة السر' },
};

router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = validate(req.body, LOGIN_SCHEMA);
  const ip = req.ip;

  // بيرمي 429 إذا الحساب مقفول أو الـ IP متجاوز الحد
  await guard.assertLoginAllowed(db, username, ip);

  const { rows } = await db.query(
    `SELECT u.*, e.name AS entity_name FROM users u
     LEFT JOIN entities e ON e.id = u.entity_id
     WHERE lower(btrim(u.username)) = lower(btrim($1))`,
    [username],
  );
  const user = rows[0];
  const ok = Boolean(user) && user.active && verifyPassword(password, user.password_hash);

  if (!ok) {
    const result = await guard.recordAttempt(db, { username, ip, success: false });
    await logAudit(db, {
      user: user || null, action: 'login_failed', table: 'users', recordId: user?.id ?? null,
      summary: `محاولة دخول فاشلة: ${username}${result.locked ? ' (تم قفل الحساب)' : ''}`, ip,
    }).catch(() => {});

    if (result.locked) {
      return res.status(429).json({
        error: `الحساب انقفل مؤقتاً بعد ${guard.MAX_USER_FAILURES} محاولات فاشلة. جرّب بعد ${guard.LOCK_MINUTES} دقيقة.`,
      });
    }
    // نفس الرسالة لليوزر الغلط وللباسورد الغلط (منع تخمين أسماء الحسابات)
    return res.status(401).json({
      error: 'اليوزر أو كلمة السر غلط',
      attempts_left: result.remaining,
    });
  }

  await guard.recordAttempt(db, { username, ip, success: true });
  setAuthCookie(res, signToken(user));
  await logAudit(db, {
    user, action: 'login', table: 'users', recordId: user.id,
    summary: `تسجيل دخول: ${user.display_name}`, ip,
  });

  res.json({
    user: {
      id: user.id, username: user.username, display_name: user.display_name,
      role: user.role, entity_id: user.entity_id, entity_name: user.entity_name,
      notifications_on: user.notifications_on,
    },
    home: HOME_BY_ROLE[user.role] || '/',
  });
}));

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'مش مسجّل دخول' });
  const { credentials_changed_at, locked_until, ...safe } = req.user;
  res.json({ user: safe, home: HOME_BY_ROLE[req.user.role] || '/' });
});

const CREDENTIALS_SCHEMA = {
  current_password: { type: 'string', required: true, maxLength: 200, label: 'كلمة السر الحالية' },
  new_username: { type: 'string', maxLength: 120, minLength: 3, label: 'اسم المستخدم الجديد' },
  new_password: { type: 'string', maxLength: 200, label: 'كلمة السر الجديدة' },
};

/** كل حساب بيغيّر يوزره وكلمة سرّه بنفسه - وكل الجلسات القديمة بتنتهي */
router.post('/change-credentials', requireAuth, asyncHandler(async (req, res) => {
  const input = validate(req.body, CREDENTIALS_SCHEMA);
  if (!input.new_username && !input.new_password) {
    return res.status(400).json({ error: 'حدّد يوزر جديد أو كلمة سر جديدة' });
  }

  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const user = rows[0];
  if (!verifyPassword(input.current_password, user.password_hash)) {
    await guard.recordAttempt(db, { username: user.username, ip: req.ip, success: false });
    return res.status(401).json({ error: 'كلمة السر الحالية غلط' });
  }

  const nextUsername = input.new_username || user.username;
  if (input.new_password) {
    const bad = validatePassword(input.new_password, { username: nextUsername });
    if (bad) return res.status(400).json({ error: bad });
    if (verifyPassword(input.new_password, user.password_hash)) {
      return res.status(400).json({ error: 'كلمة السر الجديدة لازم تكون مختلفة عن الحالية' });
    }
  }

  const updated = await db.withTransaction(async (client) => {
    const sets = ['credentials_changed_at = now()', 'updated_at = now()'];
    const params = [];
    if (input.new_username) { params.push(nextUsername); sets.push(`username = $${params.length}`); }
    if (input.new_password) {
      params.push(hashPassword(input.new_password)); sets.push(`password_hash = $${params.length}`);
      params.push(encryptSecret(input.new_password)); sets.push(`password_enc = $${params.length}`);
    }
    params.push(req.user.id);
    const { rows: saved } = await client.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params,
    );
    await logAudit(client, {
      user: req.user, action: 'update', table: 'users', recordId: req.user.id,
      before: { username: user.username },
      after: { username: nextUsername, password_changed: Boolean(input.new_password) },
      summary: 'تغيير بيانات الدخول (ذاتي)', ip: req.ip,
    });
    return saved[0];
  });

  // توكن جديد بالختم الجديد - أي جهاز تاني مسجّل دخول بينطرد
  setAuthCookie(res, signToken(updated));
  res.json({ ok: true, other_sessions_ended: true });
}));

module.exports = router;
