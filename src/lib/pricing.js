'use strict';
/**
 * التسعير:
 *  - سعر واحد ثابت لكل صنف، بس مع *تاريخ سريان* (من متى صار ساري).
 *  - حركة الزبون بتاخد السعر الساري لحظة الحركة (أو سعر استثنائي للحركة).
 *  - إذا ما في سعر ساري => الحركة "سعر معلّق" لحد ما الأدمن يحدّد السعر.
 *  - لما يتغيّر سعر مكوّن، بنقترح سعر جديد لكل صنف بيعتمد عليه بالوصفة.
 */

const { round } = require('./quantity');

/** السعر الساري لصنف بلحظة معيّنة (null إذا ما في) */
async function priceAt(db, itemId, at) {
  const { rows } = await db.query(
    `SELECT price FROM item_prices
     WHERE item_id = $1 AND effective_from <= $2
     ORDER BY effective_from DESC, id DESC LIMIT 1`,
    [itemId, at],
  );
  return rows[0] ? Number(rows[0].price) : null;
}

/** تكلفة المقادير لصنف جاهز بلحظة معيّنة */
async function bomCost(db, parentItemId, at) {
  const { rows } = await db.query(
    `SELECT ic.component_item_id, ic.quantity_per_unit, i.name AS component_name
     FROM item_components ic
     JOIN items i ON i.id = ic.component_item_id
     WHERE ic.parent_item_id = $1`,
    [parentItemId],
  );
  if (rows.length === 0) return { cost: null, complete: false, lines: [] };

  let cost = 0;
  let complete = true;
  const lines = [];
  for (const row of rows) {
    const price = await priceAt(db, row.component_item_id, at);
    if (price == null) complete = false;
    const lineCost = price == null ? null : round(price * Number(row.quantity_per_unit), 2);
    if (lineCost != null) cost += lineCost;
    lines.push({
      component_item_id: row.component_item_id,
      component_name: row.component_name,
      quantity_per_unit: Number(row.quantity_per_unit),
      component_price: price,
      line_cost: lineCost,
    });
  }
  return { cost: complete ? round(cost, 2) : round(cost, 2), complete, lines };
}

/**
 * بعد تغيير سعر مكوّن: بناء اقتراح سعر لكل صنف أب بيستعمله.
 * الاقتراح بيحافظ على نفس هامش الربح الحالي:
 *    السعر المقترح = السعر الحالي × (التكلفة الجديدة ÷ التكلفة القديمة)
 * وإذا ما في سعر حالي، بيرجع تكلفة المقادير نفسها.
 */
async function buildPriceProposals(db, { componentItemId, oldPrice, newPrice, effectiveFrom }) {
  const { rows: parents } = await db.query(
    `SELECT DISTINCT ic.parent_item_id, i.name AS parent_name
     FROM item_components ic
     JOIN items i ON i.id = ic.parent_item_id
     WHERE ic.component_item_id = $1 AND i.active = TRUE`,
    [componentItemId],
  );
  if (parents.length === 0) return [];

  const justBefore = new Date(new Date(effectiveFrom).getTime() - 1);
  const proposals = [];

  for (const parent of parents) {
    const newCost = await bomCost(db, parent.parent_item_id, effectiveFrom);
    // التكلفة القديمة = نفس الوصفة بس بالسعر القديم للمكوّن
    const oldCostInfo = await bomCostWithOverride(db, parent.parent_item_id, justBefore, componentItemId, oldPrice);
    const currentParentPrice = await priceAt(db, parent.parent_item_id, effectiveFrom);

    let suggested;
    if (currentParentPrice != null && oldCostInfo.cost > 0 && newCost.cost != null) {
      suggested = round(currentParentPrice * (newCost.cost / oldCostInfo.cost), 2);
    } else {
      suggested = newCost.cost;
    }

    proposals.push({
      parent_item_id: parent.parent_item_id,
      parent_name: parent.parent_name,
      component_item_id: componentItemId,
      old_component_price: oldPrice,
      new_component_price: newPrice,
      current_parent_price: currentParentPrice,
      suggested_price: suggested,
      cost_price: newCost.cost,
      old_cost: oldCostInfo.cost,
      effective_from: effectiveFrom,
    });
  }
  return proposals;
}

/** تكلفة المقادير مع استبدال سعر مكوّن واحد بقيمة معيّنة */
async function bomCostWithOverride(db, parentItemId, at, overrideComponentId, overridePrice) {
  const { rows } = await db.query(
    `SELECT component_item_id, quantity_per_unit FROM item_components WHERE parent_item_id = $1`,
    [parentItemId],
  );
  let cost = 0;
  for (const row of rows) {
    const price = row.component_item_id === overrideComponentId
      ? overridePrice
      : await priceAt(db, row.component_item_id, at);
    if (price != null) cost += price * Number(row.quantity_per_unit);
  }
  return { cost: round(cost, 2) };
}

module.exports = { priceAt, bomCost, buildPriceProposals, bomCostWithOverride };
