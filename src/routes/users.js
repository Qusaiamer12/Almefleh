'use strict';
const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../middleware/errors');
const { requireAuth, requireRole } = require('../middleware/auth');
const { hashPassword, encryptSecret, decryptSecret, validatePassword } = require('../lib/crypto');
const { logAudit, diffFields } = require('../lib/audit');

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
  const username = String(req.body?.username || '').trim();
  const displayName = String(req.body?.display_name || '').trim();
  const role = String(req.body?.role || '');
  const password = String(req.body?.password || '');
  const entityId = req.body?.entity_id ? Number(req.body.entity_id) : null;

  if (!username || !displayName || !role) {
    return res.status(400).json({ error: 'اليوزر والاسم والصلاحية مطلوبين' });
  }
  if (!['admin', 'recorder', 'viewer', 'customer'].includes(role)) {
    return res.status(400).json({ error: 'صلاحية غير معروفة' });
  }
  if (role === 'customer' && !entityId) {
    return res.status(400).json({ error: 'حساب الزبون لازم يكون مربوط بجهة' });
  }
  const bad = validatePassword(password);
  if (bad) return res.status(400).json({ error: bad });

  const { rows } = await db.query(
    `INSERT INTO users (username, display_name, role, password_hash, password_enc,
                        entity_id, notifications_on)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, username, display_name, role, entity_id, active, notifications_on`,
    [username, displayName, role, hashPassword(password), encryptSecret(password), entityId,
     req.body?.notifications_on !== false],
  );

  await logAudit(db, {
    user: req.user, action: 'create', table: 'users', recordId: rows[0].id,
    after: rows[0], summary: `إنشاء حساب: ${displayName} (${role})`, ip: req.ip,
  });
  res.status(201).json({ user: rows[0] });
}));

router.patch('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { rows: existing } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  const before = existing[0];
  if (!before) return res.status(404).json({ error: 'الحساب غير موجود' });

  const updates = [];
  const params = [];
  const push = (sql, value) => { params.push(value); updates.push(`${sql} = $${params.length}`); };

  if (req.body?.username != null) push('username', String(req.body.username).trim());
  if (req.body?.display_name != null) push('display_name', String(req.body.display_name).trim());
  if (req.body?.role != null) push('role', String(req.body.role));
  if (req.body?.entity_id !== undefined) push('entity_id', req.body.entity_id ? Number(req.body.entity_id) : null);
  if (req.body?.active != null) push('active', !!req.body.active);
  if (req.body?.notifications_on != null) push('notifications_on', !!req.body.notifications_on);

  if (req.body?.password) {
    const bad = validatePassword(req.body.password);
    if (bad) return res.status(400).json({ error: bad });
    push('password_hash', hashPassword(String(req.body.password)));
    push('password_enc', encryptSecret(String(req.body.password)));
  }

  if (updates.length === 0) return res.status(400).json({ error: 'ما في شي للتعديل' });

  // منع قفل النظام: لازم يضل أدمن واحد فعّال على الأقل
  if ((req.body?.active === false || (req.body?.role && req.body.role !== 'admin')) && before.role === 'admin') {
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
    summary: `تعديل حساب: ${before.display_name}${req.body?.password ? ' (تغيير كلمة السر)' : ''}`,
    ip: req.ip,
  });
  res.json({ user: rows[0], changes: diffFields(before, rows[0]) });
}));

module.exports = router;
