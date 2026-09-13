'use strict';
const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../middleware/errors');
const { requireAuth, requireRole } = require('../middleware/auth');
const { hashPassword, encryptSecret, decryptSecret, validatePassword } = require('../lib/crypto');
const { logAudit, diffFields } = require('../lib/audit');
const { validate, parseId } = require('../lib/validate');

const ROLES = ['admin', 'recorder', 'viewer', 'customer'];

const NEW_USER_SCHEMA = {
  username: { type: 'string', required: true, minLength: 3, maxLength: 120,
              pattern: /^[A-Za-z0-9._-]+$/, label: 'اسم المستخدم' },
  display_name: { type: 'string', required: true, minLength: 2, maxLength: 120, label: 'الاسم' },
  role: { type: 'enum', values: ROLES, required: true, label: 'الصلاحية' },
  password: { type: 'string', required: true, maxLength: 200, label: 'كلمة السر' },
  entity_id: { type: 'int', min: 1, label: 'الجهة' },
  notifications_on: { type: 'boolean', default: true, label: 'التنبيهات' },
};

const PATCH_USER_SCHEMA = {
  username: { type: 'string', minLength: 3, maxLength: 120,
              pattern: /^[A-Za-z0-9._-]+$/, label: 'اسم المستخدم' },
  display_name: { type: 'string', minLength: 2, maxLength: 120, label: 'الاسم' },
  role: { type: 'enum', values: ROLES, label: 'الصلاحية' },
  password: { type: 'string', maxLength: 200, label: 'كلمة السر' },
  entity_id: { type: 'int', min: 1, label: 'الجهة' },
  notifications_on: { type: 'boolean', label: 'التنبيهات' },
  active: { type: 'boolean', label: 'الحالة' },
};

const router = express.Router();
router.use(requireAuth);

/** الجهات - متاحة لكل الأدوار (المسجّل بيحتاجها لشاشة التسجيل) */
router.get('/entities', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, name, type, has_financials, active FROM entities WHERE active = TRUE ORDER BY type DESC, id',
  );
  res.json({ entities: rows });
}));

/**
 * إدارة المستخدمين - قصي (الأدمن) بس.
 * بيشوف يوزر وباسورد كل الحسابات حتى لو المستخدم غيّرها بنفسه.
 */
router.get('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.display_name, u.role, u.entity_id, u.active,
            u.notifications_on, u.password_enc, u.created_at, u.updated_at,
            e.name AS entity_name
     FROM users u LEFT JOIN entities e ON e.id = u.entity_id
     ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'recorder' THEN 1 WHEN 'viewer' THEN 2 ELSE 3 END, u.id`,
  );
  const users = rows.map(({ password_enc, ...u }) => ({
    ...u,
    password: decryptSecret(password_enc), // null إذا المفتاح تغيّر
  }));
  res.json({ users });
}));

router.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const input = validate(req.body, NEW_USER_SCHEMA);
  const { username, display_name: displayName, role, password } = input;
  const entityId = input.entity_id || null;

  if (role === 'customer' && !entityId) {
    return res.status(400).json({ error: 'حساب الزبون لازم يكون مربوط بجهة' });
  }
  if (role !== 'customer' && entityId) {
    return res.status(400).json({ error: 'الجهة بتنربط بحسابات الزباين بس' });
  }
  const bad = validatePassword(password, { username });
  if (bad) return res.status(400).json({ error: bad });

  const { rows } = await db.query(
    `INSERT INTO users (username, display_name, role, password_hash, password_enc,
                        entity_id, notifications_on)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, username, display_name, role, entity_id, active, notifications_on`,
    [username, displayName, role, hashPassword(password), encryptSecret(password), entityId,
     input.notifications_on !== false],
  );

  await logAudit(db, {
    user: req.user, action: 'create', table: 'users', recordId: rows[0].id,
    after: rows[0], summary: `إنشاء حساب: ${displayName} (${role})`, ip: req.ip,
  });
  res.status(201).json({ user: rows[0] });
}));

router.patch('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'رقم الحساب');
  const { rows: existing } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  const before = existing[0];
  if (!before) return res.status(404).json({ error: 'الحساب غير موجود' });

  const input = validate(req.body, PATCH_USER_SCHEMA);
  const updates = [];
  const params = [];
  const push = (sql, value) => { params.push(value); updates.push(`${sql} = $${params.length}`); };

  if (input.username != null) push('username', input.username);
  if (input.display_name != null) push('display_name', input.display_name);
  if (input.role != null) push('role', input.role);
  if ('entity_id' in input) push('entity_id', input.entity_id || null);
  if (input.active != null) push('active', input.active);
  if (input.notifications_on != null) push('notifications_on', input.notifications_on);

  if (input.password) {
    const bad = validatePassword(input.password, { username: input.username || before.username });
    if (bad) return res.status(400).json({ error: bad });
    push('password_hash', hashPassword(input.password));
    push('password_enc', encryptSecret(input.password));
  }

  // تغيير اليوزر أو كلمة السر بينهي كل جلسات هذا الحساب المفتوحة
  if (input.password || input.username) updates.push('credentials_changed_at = now()');
  // إيقاف الحساب بينهي جلساته كمان
  if (input.active === false) updates.push('credentials_changed_at = now()');

  if (updates.length === 0) return res.status(400).json({ error: 'ما في شي للتعديل' });

  // منع قفل النظام: لازم يضل أدمن واحد فعّال على الأقل
  if ((input.active === false || (input.role && input.role !== 'admin')) && before.role === 'admin') {
    const { rows: admins } = await db.query(
      "SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin' AND active = TRUE AND id <> $1", [id],
    );
    if (admins[0].c === 0) {
      return res.status(400).json({ error: 'لازم يضل حساب أدمن فعّال واحد على الأقل' });
    }
  }

  params.push(id);
  const { rows } = await db.query(
    `UPDATE users SET ${updates.join(', ')}, updated_at = now() WHERE id = $${params.length}
     RETURNING id, username, display_name, role, entity_id, active, notifications_on`,
    params,
  );

  await logAudit(db, {
    user: req.user, action: 'update', table: 'users', recordId: id,
    before: { ...before, password_hash: '***', password_enc: '***' },
    after: rows[0],
    summary: `تعديل حساب: ${before.display_name}${input.password ? ' (تغيير كلمة السر)' : ''}`,
    ip: req.ip,
  });
  res.json({ user: rows[0], changes: diffFields(before, rows[0]) });
}));

/** فك قفل حساب انقفل بسبب محاولات دخول فاشلة */
router.post('/:id/unlock', requireRole('admin'), asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'رقم الحساب');
  const { rows } = await db.query(
    'UPDATE users SET locked_until = NULL WHERE id = $1 RETURNING id, display_name', [id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'الحساب غير موجود' });
  await db.query(
    `INSERT INTO login_attempts (username, ip, success)
     SELECT username, $2, TRUE FROM users WHERE id = $1`, [id, req.ip],
  );
  await logAudit(db, {
    user: req.user, action: 'update', table: 'users', recordId: id,
    summary: `فك قفل حساب: ${rows[0].display_name}`, ip: req.ip,
  });
  res.json({ ok: true });
}));

module.exports = router;
