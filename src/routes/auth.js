'use strict';
const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../middleware/errors');
const { signToken, setAuthCookie, clearAuthCookie, requireAuth } = require('../middleware/auth');
const { hashPassword, verifyPassword, encryptSecret, validatePassword } = require('../lib/crypto');
const { logAudit } = require('../lib/audit');

const router = express.Router();

/** الصفحة الرئيسية لكل دور بعد الدخول */
const HOME_BY_ROLE = {
  admin: '/admin',
  recorder: '/record',
  viewer: '/overview',
  customer: '/customer',
};

router.post('/login', asyncHandler(async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) {
    return res.status(400).json({ error: 'اليوزر وكلمة السر مطلوبين' });
  }

  const { rows } = await db.query(
    `SELECT u.*, e.name AS entity_name FROM users u
     LEFT JOIN entities e ON e.id = u.entity_id
     WHERE lower(u.username) = lower($1)`,
    [username],
  );
  const user = rows[0];
  if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'اليوزر أو كلمة السر غلط' });
  }

  setAuthCookie(res, signToken(user));
  await logAudit(db, {
    user, action: 'login', table: 'users', recordId: user.id,
    summary: `تسجيل دخول: ${user.display_name}`, ip: req.ip,
  });

  res.json({
    user: {
      id: user.id, username: user.username, display_name: user.display_name,
      role: user.role, entity_id: user.entity_id, entity_name: user.entity_name,
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
  res.json({ user: req.user, home: HOME_BY_ROLE[req.user.role] || '/' });
});

/** كل حساب بيقدر يغيّر يوزره وكلمة سرّه بنفسه */
router.post('/change-credentials', requireAuth, asyncHandler(async (req, res) => {
  const currentPassword = String(req.body?.current_password || '');
  const newUsername = req.body?.new_username ? String(req.body.new_username).trim() : null;
  const newPassword = req.body?.new_password ? String(req.body.new_password) : null;

  if (!newUsername && !newPassword) {
    return res.status(400).json({ error: 'حدّد يوزر جديد أو كلمة سر جديدة' });
  }

  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const user = rows[0];
  if (!verifyPassword(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'كلمة السر الحالية غلط' });
  }

  if (newPassword) {
    const bad = validatePassword(newPassword);
    if (bad) return res.status(400).json({ error: bad });
  }

  const before = { username: user.username };
  const updates = [];
  const params = [];
  if (newUsername) { params.push(newUsername); updates.push(`username = $${params.length}`); }
  if (newPassword) {
    params.push(hashPassword(newPassword));
    updates.push(`password_hash = $${params.length}`);
    params.push(encryptSecret(newPassword));
    updates.push(`password_enc = $${params.length}`);
  }
  params.push(req.user.id);
  await db.query(
    `UPDATE users SET ${updates.join(', ')}, updated_at = now() WHERE id = $${params.length}`,
    params,
  );

  await logAudit(db, {
    user: req.user, action: 'update', table: 'users', recordId: req.user.id,
    before, after: { username: newUsername || user.username, password_changed: !!newPassword },
    summary: 'تغيير بيانات الدخول (ذاتي)', ip: req.ip,
  });

  // اليوزر تغيّر => نجدّد التوكن
  setAuthCookie(res, signToken({ ...user, username: newUsername || user.username }));
  res.json({ ok: true });
}));

module.exports = router;
