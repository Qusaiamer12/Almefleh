'use strict';
const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../middleware/errors');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAudit } = require('../lib/audit');
const { validate, parseId } = require('../lib/validate');

const router = express.Router();
// اقتراحات تعديل الأسعار: قصي بس
router.use(requireAuth, requireRole('admin'));

router.get('/', asyncHandler(async (req, res) => {
  const status = req.query.status || 'pending';
  const { rows } = await db.query(
    `SELECT p.*, pi.name AS parent_name, pi.unit AS parent_unit, ci.name AS component_name
     FROM price_proposals p
     JOIN items pi ON pi.id = p.parent_item_id
     LEFT JOIN items ci ON ci.id = p.component_item_id
     WHERE ($1 = 'all' OR p.status = $1::proposal_status)
     ORDER BY p.created_at DESC LIMIT 100`,
    [status],
  );
  res.json({ proposals: rows });
}));

/** الموافقة: بينحفظ سعر جديد للصنف الجاهز بتاريخ سريان */
const ACCEPT_SCHEMA = {
  price: { type: 'number', min: 0, max: 1e9, label: 'السعر' },
  effective_from: { type: 'date', label: 'تاريخ السريان' },
};

router.post('/:id/accept', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'رقم الاقتراح');
  const input = validate(req.body, ACCEPT_SCHEMA);

  await db.withTransaction(async (client) => {
    // تحديث ذرّي: أول واحد بيمرّ بس. الطلب المكرّر بيلاقي الحالة مش pending.
    const { rows: claimed } = await client.query(
      `UPDATE price_proposals SET status = 'accepted', decided_by = $1, decided_at = now()
       WHERE id = $2 AND status = 'pending'
       RETURNING *`,
      [req.user.id, id],
    );
    const proposal = claimed[0];
    if (!proposal) {
      const e = new Error('الاقتراح غير موجود أو تم البتّ فيه مسبقاً');
      e.status = 409;
      throw e;
    }

    const price = input.price != null ? input.price : Number(proposal.suggested_price);
    if (!Number.isFinite(price) || price < 0) {
      const e = new Error('ما في سعر مقترح صالح - حدّد السعر يدوي'); e.status = 400; throw e;
    }
    const effectiveFrom = input.effective_from || new Date(proposal.effective_from);

    await client.query(
      `INSERT INTO item_prices (item_id, price, effective_from, note, created_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (item_id, effective_from)
       DO UPDATE SET price = EXCLUDED.price, note = EXCLUDED.note`,
      [proposal.parent_item_id, price, effectiveFrom, 'تعديل تلقائي بعد تغيّر سعر المقادير', req.user.id],
    );
    await logAudit(client, {
      user: req.user, action: 'update', table: 'price_proposals', recordId: id,
      before: proposal, after: { status: 'accepted', price, effective_from: effectiveFrom },
      summary: `قبول تعديل سعر (صنف #${proposal.parent_item_id}) إلى ${price} من ${effectiveFrom.toISOString()}`,
      ip: req.ip,
    });
  });

  res.json({ ok: true });
}));

router.post('/:id/reject', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'رقم الاقتراح');
  const { rows } = await db.query(
    `UPDATE price_proposals SET status = 'rejected', decided_by = $1, decided_at = now()
     WHERE id = $2 AND status = 'pending' RETURNING *`,
    [req.user.id, id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'الاقتراح غير موجود أو تم البتّ فيه' });
  await logAudit(db, {
    user: req.user, action: 'update', table: 'price_proposals', recordId: id,
    after: rows[0], summary: 'رفض اقتراح تعديل سعر', ip: req.ip,
  });
  res.json({ ok: true });
}));

module.exports = router;
