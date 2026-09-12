'use strict';
const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../middleware/errors');
const { requireAuth, requireRole, canSeeMoney } = require('../middleware/auth');
const { logAudit, diffFields } = require('../lib/audit');
const { notifyAdmins, TYPES } = require('../lib/notify');
const { priceAt, bomCost, buildPriceProposals } = require('../lib/pricing');

const router = express.Router();
router.use(requireAuth);

/** قائمة الأصناف - مع بحث وفلترة بالحرف الأول (لشاشة الكاشير) */
router.get('/', asyncHandler(async (req, res) => {
  const search = String(req.query.search || '').trim();
  const letter = String(req.query.letter || '').trim();
  const includeInactive = String(req.query.include_inactive || '') === 'true';

  const where = [];
  const params = [];
  if (!includeInactive) where.push('s.active = TRUE');
  if (search) { params.push(`%${search}%`); where.push(`s.item_name ILIKE $${params.length}`); }
  if (letter) { params.push(`${letter}%`); where.push(`s.item_name LIKE $${params.length}`); }

  const { rows } = await db.query(
    `SELECT s.item_id AS id, s.item_name AS name, s.unit, s.active,
            s.quantity, s.current_price, s.last_movement_at,
            EXISTS (SELECT 1 FROM item_components ic WHERE ic.parent_item_id = s.item_id) AS has_recipe
     FROM v_stock s
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY s.item_name`,
    params,
  );

  // المسجّل (عبود) ما بيشوف ستوك ولا أسعار
  const payload = canSeeMoney(req.user)
    ? rows
    : rows.map(({ quantity, current_price, ...rest }) => ({
        ...rest,
        needs_price: current_price == null,
      }));

  res.json({ items: payload });
}));

/** الحروف اللي عندها أصناف - لبار الأبجدية */
router.get('/letters', asyncHandler(async (_req, res) => {
  const { rows } = await db.query(
    `SELECT DISTINCT left(name, 1) AS letter FROM items WHERE active = TRUE ORDER BY 1`,
  );
  res.json({ letters: rows.map((r) => r.letter) });
}));

/** إضافة صنف: الأدمن بيحط سعر، والمسجّل (عبود) بيضيف بدون سعر */
router.post('/', requireRole('admin', 'recorder'), asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const unit = req.body?.unit === 'kg' ? 'kg' : 'piece';
  if (!name) return res.status(400).json({ error: 'اسم الصنف مطلوب' });

  const exists = await db.query('SELECT id FROM items WHERE lower(name) = lower($1)', [name]);
  if (exists.rows[0]) return res.status(409).json({ error: 'في صنف بنفس الاسم' });

  const { rows } = await db.query(
    'INSERT INTO items (name, unit, created_by) VALUES ($1,$2,$3) RETURNING *',
    [name, unit, req.user.id],
  );
  const item = rows[0];

  // الأدمن بس بيقدر يحط سعر مباشرة
  let price = null;
  if (req.user.role === 'admin' && req.body?.price != null && req.body.price !== '') {
    price = Number(req.body.price);
    if (!(price >= 0)) return res.status(400).json({ error: 'سعر غير صالح' });
    const effectiveFrom = req.body.effective_from ? new Date(req.body.effective_from) : new Date();
    await db.query(
      'INSERT INTO item_prices (item_id, price, effective_from, created_by, note) VALUES ($1,$2,$3,$4,$5)',
      [item.id, price, effectiveFrom, req.user.id, 'سعر أوّلي'],
    );
  }

  await logAudit(db, {
    user: req.user, action: 'create', table: 'items', recordId: item.id,
    after: { ...item, price }, summary: `إضافة صنف: ${name}`, ip: req.ip,
  });

  // الصنف اللي انضاف بدون سعر لازم الأدمن ينتبهله
  if (price == null) {
    await notifyAdmins(db, {
      type: TYPES.PENDING_PRICE,
      title: 'صنف جديد بدون سعر',
      body: `"${name}" انضاف من ${req.user.display_name} وبده سعر`,
      data: { item_id: item.id, item_name: name },
    });
  }

  res.status(201).json({ item: { ...item, current_price: price } });
}));

/** تعديل صنف (الاسم/الوحدة/التفعيل) - أدمن فقط */
router.patch('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { rows: existing } = await db.query('SELECT * FROM items WHERE id = $1', [id]);
  const before = existing[0];
  if (!before) return res.status(404).json({ error: 'الصنف غير موجود' });

  const name = req.body?.name != null ? String(req.body.name).trim() : before.name;
  const unit = req.body?.unit != null ? (req.body.unit === 'kg' ? 'kg' : 'piece') : before.unit;
  const active = req.body?.active != null ? !!req.body.active : before.active;

  if (unit !== before.unit) {
    const used = await db.query(
      'SELECT 1 FROM transactions WHERE item_id = $1 AND deleted_at IS NULL LIMIT 1', [id],
    );
    if (used.rows[0]) {
      return res.status(400).json({ error: 'ما بينفع تغيّر وحدة صنف عليه حركات مسجّلة' });
    }
  }

  const { rows } = await db.query(
    'UPDATE items SET name = $1, unit = $2, active = $3 WHERE id = $4 RETURNING *',
    [name, unit, active, id],
  );
  await logAudit(db, {
    user: req.user, action: 'update', table: 'items', recordId: id,
    before, after: rows[0], summary: `تعديل صنف: ${before.name}`,
    ip: req.ip,
  });
  res.json({ item: rows[0], changes: diffFields(before, rows[0]) });
}));

/** تاريخ أسعار الصنف */
router.get('/:id/prices', requireRole('admin', 'viewer'), asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.*, u.display_name AS created_by_name
     FROM item_prices p LEFT JOIN users u ON u.id = p.created_by
     WHERE p.item_id = $1 ORDER BY p.effective_from DESC, p.id DESC`,
    [Number(req.params.id)],
  );
  res.json({ prices: rows });
}));

/**
 * تحديد/تغيير سعر صنف بتاريخ سريان.
 * النتيجة: كل الحركات من تاريخ السريان وجاي بتاخد السعر الجديد تلقائياً
 * (لأن المبالغ مشتقّة من الـ view)، وبينبني اقتراح سعر لكل صنف بيعتمد عليه.
 */
router.post('/:id/prices', requireRole('admin'), asyncHandler(async (req, res) => {
  const itemId = Number(req.params.id);
  const price = Number(req.body?.price);
  if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: 'سعر غير صالح' });

  const effectiveFrom = req.body?.effective_from ? new Date(req.body.effective_from) : new Date();
  if (Number.isNaN(effectiveFrom.getTime())) return res.status(400).json({ error: 'تاريخ سريان غير صالح' });

  const { rows: itemRows } = await db.query('SELECT * FROM items WHERE id = $1', [itemId]);
  const item = itemRows[0];
  if (!item) return res.status(404).json({ error: 'الصنف غير موجود' });

  const oldPrice = await priceAt(db, itemId, effectiveFrom);

  const result = await db.withTransaction(async (client) => {
    await client.query(
      `INSERT INTO item_prices (item_id, price, effective_from, note, created_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (item_id, effective_from)
       DO UPDATE SET price = EXCLUDED.price, note = EXCLUDED.note, created_by = EXCLUDED.created_by`,
      [itemId, price, effectiveFrom, req.body?.note || null, req.user.id],
    );

    await logAudit(client, {
      user: req.user, action: 'update', table: 'item_prices', recordId: itemId,
      before: { price: oldPrice }, after: { price, effective_from: effectiveFrom },
      summary: `تغيير سعر "${item.name}" من ${oldPrice ?? '—'} إلى ${price} اعتباراً من ${effectiveFrom.toISOString()}`,
      ip: req.ip,
    });

    // كم حركة زبون تأثّرت بهالتغيير
    const { rows: affected } = await client.query(
      `SELECT COUNT(*)::int AS count FROM transactions
       WHERE item_id = $1 AND deleted_at IS NULL AND unit_price_override IS NULL
         AND kind IN ('customer_out','customer_return') AND occurred_at >= $2`,
      [itemId, effectiveFrom],
    );

    // اقتراحات تعديل أسعار الأصناف اللي بتعتمد على هالصنف بالوصفة
    const proposals = await buildPriceProposals(client, {
      componentItemId: itemId,
      oldPrice, newPrice: price, effectiveFrom,
    });

    for (const p of proposals) {
      const { rows: inserted } = await client.query(
        `INSERT INTO price_proposals
           (parent_item_id, component_item_id, old_component_price, new_component_price,
            current_parent_price, suggested_price, cost_price, effective_from)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [p.parent_item_id, p.component_item_id, p.old_component_price, p.new_component_price,
         p.current_parent_price, p.suggested_price, p.cost_price, p.effective_from],
      );
      await notifyAdmins(client, {
        type: TYPES.PRICE_CHANGE,
        title: `سعر "${item.name}" تغيّر`,
        body: `بدك تعدّل سعر "${p.parent_name}" المرتبط فيه؟ المقترح: ${p.suggested_price ?? '—'} (الحالي: ${p.current_parent_price ?? '—'})`,
        data: { proposal_id: inserted[0].id, parent_item_id: p.parent_item_id },
      });
    }

    return { affected: affected[0].count, proposals };
  });

  res.status(201).json({
    ok: true,
    old_price: oldPrice,
    new_price: price,
    effective_from: effectiveFrom,
    affected_transactions: result.affected,
    proposals: result.proposals,
  });
}));

/** حذف سعر من التاريخ (تصحيح غلط) */
router.delete('/:id/prices/:priceId', requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    'DELETE FROM item_prices WHERE id = $1 AND item_id = $2 RETURNING *',
    [Number(req.params.priceId), Number(req.params.id)],
  );
  if (!rows[0]) return res.status(404).json({ error: 'السعر غير موجود' });
  await logAudit(db, {
    user: req.user, action: 'delete', table: 'item_prices', recordId: rows[0].id,
    before: rows[0], summary: 'حذف سعر من تاريخ الأسعار', ip: req.ip,
  });
  res.json({ ok: true });
}));

/** وصفة الصنف (المقادير) */
router.get('/:id/recipe', requireRole('admin', 'viewer'), asyncHandler(async (req, res) => {
  const itemId = Number(req.params.id);
  const { rows } = await db.query(
    `SELECT ic.id, ic.component_item_id, i.name AS component_name, i.unit AS component_unit,
            ic.quantity_per_unit
     FROM item_components ic JOIN items i ON i.id = ic.component_item_id
     WHERE ic.parent_item_id = $1 ORDER BY i.name`,
    [itemId],
  );
  const cost = await bomCost(db, itemId, new Date());
  const currentPrice = await priceAt(db, itemId, new Date());
  res.json({
    components: rows,
    cost: cost.cost,
    cost_complete: cost.complete,
    current_price: currentPrice,
    margin: currentPrice != null && cost.cost ? Number((currentPrice - cost.cost).toFixed(2)) : null,
  });
}));

/** حفظ الوصفة كاملة (استبدال) - أدمن فقط */
router.put('/:id/recipe', requireRole('admin'), asyncHandler(async (req, res) => {
  const itemId = Number(req.params.id);
  const components = Array.isArray(req.body?.components) ? req.body.components : [];

  for (const c of components) {
    if (Number(c.component_item_id) === itemId) {
      return res.status(400).json({ error: 'ما بينفع الصنف يكون مكوّن حاله' });
    }
    if (!(Number(c.quantity_per_unit) > 0)) {
      return res.status(400).json({ error: 'كمية المكوّن لازم تكون أكبر من صفر' });
    }
  }

  const { rows: before } = await db.query(
    'SELECT component_item_id, quantity_per_unit FROM item_components WHERE parent_item_id = $1',
    [itemId],
  );

  await db.withTransaction(async (client) => {
    await client.query('DELETE FROM item_components WHERE parent_item_id = $1', [itemId]);
    for (const c of components) {
      await client.query(
        `INSERT INTO item_components (parent_item_id, component_item_id, quantity_per_unit)
         VALUES ($1,$2,$3)`,
        [itemId, Number(c.component_item_id), Number(c.quantity_per_unit)],
      );
    }
    await logAudit(client, {
      user: req.user, action: 'update', table: 'item_components', recordId: itemId,
      before: { components: before }, after: { components },
      summary: 'تعديل مقادير الصنف', ip: req.ip,
    });
  });

  const cost = await bomCost(db, itemId, new Date());
  res.json({ ok: true, cost: cost.cost, cost_complete: cost.complete });
}));

module.exports = router;
