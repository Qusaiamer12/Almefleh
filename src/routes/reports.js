'use strict';
const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../middleware/errors');
const { requireAuth, requireRole } = require('../middleware/auth');
const { priceAt } = require('../lib/pricing');
const { round } = require('../lib/quantity');
const dates = require('../lib/dates');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'viewer'));

function resolvePeriod(query) {
  if (query.from && query.to) {
    const range = dates.customRange(query.from, query.to);
    return { ...range, label: `من ${query.from} إلى ${query.to}`, type: 'custom' };
  }
  const offset = Number(query.week || 0);
  const range = dates.weekRangeOffset(offset);
  return {
    ...range,
    label: `أسبوع ${dates.toDateString(range.from)} → ${dates.toDateString(new Date(range.to.getTime() - 1))}`,
    type: 'week', offset,
  };
}

/**
 * تقرير النقص/الفاقد: المتوقع حسب المقادير مقابل الفعلي اللي رجع من المشغل.
 *
 * لكل صنف جاهز إله وصفة ورجع منه إنتاج بالفترة:
 *   - المطلوب من كل مكوّن = الإنتاج الفعلي × كمية المكوّن بالوصفة
 *   - الإنتاج المتوقّع     = المادة الخام اللي طلعت فعلاً ÷ كمية المكوّن بالوصفة
 *   - الفاقد = الإنتاج المتوقّع − الإنتاج الفعلي
 *
 * إذا المكوّن داخل بأكتر من صنف، بنوزّع الكمية اللي طلعت عليهم
 * بنسبة احتياج كل صنف.
 */
router.get('/loss', asyncHandler(async (req, res) => {
  const period = resolvePeriod(req.query);

  const { rows: outputs } = await db.query(
    `SELECT item_id, SUM(quantity) AS qty FROM v_transactions
     WHERE kind = 'operator_in' AND occurred_at >= $1 AND occurred_at < $2
     GROUP BY item_id`,
    [period.from, period.to],
  );
  const { rows: issues } = await db.query(
    `SELECT item_id, SUM(quantity) AS qty FROM v_transactions
     WHERE kind = 'operator_out' AND occurred_at >= $1 AND occurred_at < $2
     GROUP BY item_id`,
    [period.from, period.to],
  );

  const outputByItem = new Map(outputs.map((r) => [r.item_id, Number(r.qty)]));
  const issuedByItem = new Map(issues.map((r) => [r.item_id, Number(r.qty)]));

  const { rows: recipes } = await db.query(
    `SELECT ic.parent_item_id, p.name AS parent_name, p.unit AS parent_unit,
            ic.component_item_id, c.name AS component_name, c.unit AS component_unit,
            ic.quantity_per_unit
     FROM item_components ic
     JOIN items p ON p.id = ic.parent_item_id
     JOIN items c ON c.id = ic.component_item_id
     ORDER BY p.name, c.name`,
  );

  // تجميع الوصفات حسب الصنف الجاهز
  const parents = new Map();
  for (const r of recipes) {
    if (!parents.has(r.parent_item_id)) {
      parents.set(r.parent_item_id, {
        item_id: r.parent_item_id, item_name: r.parent_name, unit: r.parent_unit,
        actual_output: outputByItem.get(r.parent_item_id) || 0,
        components: [],
      });
    }
    parents.get(r.parent_item_id).components.push({
      component_item_id: r.component_item_id,
      component_name: r.component_name,
      component_unit: r.component_unit,
      quantity_per_unit: Number(r.quantity_per_unit),
    });
  }

  // إجمالي الاحتياج لكل مكوّن عبر كل الأصناف (لتوزيع المادة الخام المشتركة)
  const requiredTotals = new Map();
  for (const parent of parents.values()) {
    for (const c of parent.components) {
      const required = parent.actual_output * c.quantity_per_unit;
      requiredTotals.set(c.component_item_id, (requiredTotals.get(c.component_item_id) || 0) + required);
    }
  }

  const productionLines = [];
  for (const parent of parents.values()) {
    const issuedForAny = parent.components.some((c) => (issuedByItem.get(c.component_item_id) || 0) > 0);
    if (parent.actual_output === 0 && !issuedForAny) continue; // ما صار شي بالفترة

    let expectedOutput = null;
    const components = parent.components.map((c) => {
      const required = round(parent.actual_output * c.quantity_per_unit, 3);
      const issuedTotal = issuedByItem.get(c.component_item_id) || 0;
      const totalRequired = requiredTotals.get(c.component_item_id) || 0;

      // حصّة هذا الصنف من المادة الخام المشتركة
      const share = totalRequired > 0 ? required / totalRequired : (parents.size ? 1 / countParentsUsing(parents, c.component_item_id) : 1);
      const allocatedIssued = round(issuedTotal * share, 3);
      const expectedFromThis = c.quantity_per_unit > 0 ? allocatedIssued / c.quantity_per_unit : null;

      if (expectedFromThis != null) {
        expectedOutput = expectedOutput == null ? expectedFromThis : Math.min(expectedOutput, expectedFromThis);
      }
      return {
        ...c,
        required,
        issued_total: round(issuedTotal, 3),
        allocated_issued: allocatedIssued,
        expected_output_from_component: expectedFromThis == null ? null : round(expectedFromThis, 3),
        difference: round(allocatedIssued - required, 3),
      };
    });

    const expected = expectedOutput == null ? null : round(expectedOutput, 3);
    const loss = expected == null ? null : round(expected - parent.actual_output, 3);
    productionLines.push({
      item_id: parent.item_id,
      item_name: parent.item_name,
      unit: parent.unit,
      actual_output: round(parent.actual_output, 3),
      expected_output: expected,
      loss_units: loss,
      loss_percent: expected && expected > 0 ? round((loss / expected) * 100, 2) : null,
      components,
    });
  }

  // ملخّص على مستوى المادة الخام
  const componentLines = [];
  for (const [componentId, requiredTotal] of requiredTotals.entries()) {
    const issued = issuedByItem.get(componentId) || 0;
    if (issued === 0 && requiredTotal === 0) continue;
    const info = recipes.find((r) => r.component_item_id === componentId);
    const price = await priceAt(db, componentId, period.to);
    const difference = round(issued - requiredTotal, 3);
    componentLines.push({
      item_id: componentId,
      item_name: info.component_name,
      unit: info.component_unit,
      issued: round(issued, 3),
      required: round(requiredTotal, 3),
      difference,                                   // موجب = استهلاك زايد عن الوصفة
      price,
      loss_value: price == null ? null : round(difference * price, 2),
    });
  }

  // مواد خام طلعت للمشغل بس ما إلها وصفة مرتبطة
  const unlinked = [];
  for (const [itemId, qty] of issuedByItem.entries()) {
    if (!requiredTotals.has(itemId)) {
      const { rows } = await db.query('SELECT name, unit FROM items WHERE id = $1', [itemId]);
      unlinked.push({ item_id: itemId, item_name: rows[0]?.name, unit: rows[0]?.unit, issued: round(qty, 3) });
    }
  }

  res.json({
    period,
    production: productionLines,
    components: componentLines,
    unlinked_issues: unlinked,
    summary: {
      total_loss_value: round(componentLines.reduce((s, c) => s + (c.loss_value || 0), 0), 2),
      items_with_loss: productionLines.filter((p) => (p.loss_units || 0) > 0).length,
    },
  });
}));

function countParentsUsing(parents, componentId) {
  let n = 0;
  for (const p of parents.values()) if (p.components.some((c) => c.component_item_id === componentId)) n += 1;
  return n || 1;
}

/** حركة المشغل بالفترة (كمّية بحتة) */
router.get('/operator', asyncHandler(async (req, res) => {
  const period = resolvePeriod(req.query);
  const { rows } = await db.query(
    `SELECT v.item_id, v.item_name, v.item_unit,
            SUM(CASE WHEN v.kind = 'operator_out' THEN v.quantity ELSE 0 END) AS issued,
            SUM(CASE WHEN v.kind = 'operator_in'  THEN v.quantity ELSE 0 END) AS returned
     FROM v_transactions v
     WHERE v.kind IN ('operator_out','operator_in')
       AND v.occurred_at >= $1 AND v.occurred_at < $2
     GROUP BY v.item_id, v.item_name, v.item_unit
     ORDER BY v.item_name`,
    [period.from, period.to],
  );
  res.json({ period, lines: rows });
}));

module.exports = router;
