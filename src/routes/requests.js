'use strict';
const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../middleware/errors');
const { requireAuth, requireRole } = require('../middleware/auth');
const { notifyAdmins, TYPES } = require('../lib/notify');
const { logAudit } = require('../lib/audit');

const router = express.Router();
router.use(requireAuth);

/** الزبون بيبعت ملاحظة أو طلب - بيوصل الأدمن */
router.post('/', requireRole('customer'), asyncHandler(async (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'اكتب الملاحظة أو الطلب' });
  if (body.length > 2000) return res.status(400).json({ error: 'النص طويل كتير' });

  const { rows } = await db.query(
    'INSERT INTO customer_requests (entity_id, user_id, body) VALUES ($1,$2,$3) RETURNING *',
    [req.user.entity_id, req.user.id, body],
  );

  await notifyAdmins(db, {
    type: TYPES.CUSTOMER_REQUEST,
    title: `طلب/ملاحظة من ${req.user.entity_name || req.user.display_name}`,
    body: body.slice(0, 180),
    data: { request_id: rows[0].id, entity_id: req.user.entity_id },
  });

  res.status(201).json({ request: rows[0] });
}));

/** الزبون بيشوف طلباته، الأدمن/الاطّلاع بيشوفوا الكل */
router.get('/', asyncHandler(async (req, res) => {
  if (req.user.role === 'recorder') {
    return res.status(403).json({ error: 'ما عندك صلاحية' });
  }
  const params = [];
  const where = ['TRUE'];
  if (req.user.role === 'customer') {
    params.push(req.user.entity_id);
    where.push(`r.entity_id = $${params.length}`);
  }
  if (String(req.query.open_only || '') === 'true') where.push('r.handled = FALSE');

  const { rows } = await db.query(
    `SELECT r.*, e.name AS entity_name, u.display_name AS user_name,
            h.display_name AS handled_by_name
     FROM customer_requests r
     JOIN entities e ON e.id = r.entity_id
     LEFT JOIN users u ON u.id = r.user_id
     LEFT JOIN users h ON h.id = r.handled_by
     WHERE ${where.join(' AND ')}
     ORDER BY r.handled, r.created_at DESC LIMIT 200`,
    params,
  );
  res.json({ requests: rows });
}));

/** الأدمن بيعلّم الطلب كمعالَج */
router.patch('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const handled = req.body?.handled !== false;
  const { rows } = await db.query(
    `UPDATE customer_requests
     SET handled = $1, handled_by = $2, handled_at = CASE WHEN $1 THEN now() ELSE NULL END
     WHERE id = $3 RETURNING *`,
    [handled, req.user.id, Number(req.params.id)],
  );
  if (!rows[0]) return res.status(404).json({ error: 'الطلب غير موجود' });
  await logAudit(db, {
    user: req.user, action: 'update', table: 'customer_requests', recordId: rows[0].id,
    after: rows[0], summary: handled ? 'إغلاق طلب زبون' : 'إعادة فتح طلب زبون', ip: req.ip,
  });
  res.json({ request: rows[0] });
}));

module.exports = router;
