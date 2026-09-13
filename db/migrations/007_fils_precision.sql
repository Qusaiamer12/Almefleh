-- ==========================================================================
-- دقّة الفلس: الدينار الأردني ألف فلس، يعني ٣ منازل عشرية مش منزلتين
-- ==========================================================================
-- كتالوج المستودع الحقيقي فيه أسعار زي 0.025 و 3.735 - بمنزلتين بتصير
-- 0.03 و 3.74، يعني فرق يوصل ٢٠٪ على الأصناف الرخيصة.

-- الـ views بتمنع تغيير نوع العمود، فبنسقّطها وبنعيد بناءها بعد التغيير
DROP VIEW IF EXISTS v_customer_totals;
DROP VIEW IF EXISTS v_stock_summary;
DROP VIEW IF EXISTS v_balances;
DROP VIEW IF EXISTS v_stock;
DROP FUNCTION IF EXISTS entity_period_summary(INTEGER, TIMESTAMPTZ, TIMESTAMPTZ);
DROP VIEW IF EXISTS v_transactions;

ALTER TABLE item_prices  ALTER COLUMN price              TYPE NUMERIC(14,3);
ALTER TABLE items        ALTER COLUMN cost_price         TYPE NUMERIC(14,3);
ALTER TABLE transactions ALTER COLUMN unit_price_override TYPE NUMERIC(14,3);
ALTER TABLE transactions ALTER COLUMN payment_amount     TYPE NUMERIC(14,3);
ALTER TABLE price_proposals
  ALTER COLUMN old_component_price  TYPE NUMERIC(14,3),
  ALTER COLUMN new_component_price  TYPE NUMERIC(14,3),
  ALTER COLUMN current_parent_price TYPE NUMERIC(14,3),
  ALTER COLUMN suggested_price      TYPE NUMERIC(14,3),
  ALTER COLUMN cost_price           TYPE NUMERIC(14,3);

-- إعادة بناء الـ view بتقريب ٣ منازل
CREATE OR REPLACE VIEW v_transactions AS
SELECT
  t.id, t.kind, t.entity_id,
  e.name AS entity_name, e.type AS entity_type,
  t.item_id, i.name AS item_name, i.unit AS item_unit,
  t.quantity, t.quantity_input, t.payment_amount, t.method, t.note,
  t.occurred_at, t.created_by, t.created_at, t.updated_by, t.updated_at,
  t.client_token,
  COALESCE(t.unit_price_override, p.price) AS unit_price,
  (t.unit_price_override IS NOT NULL)      AS price_overridden,
  CASE
    WHEN t.kind = 'payment' THEN t.payment_amount
    WHEN t.kind IN ('customer_out','customer_return')
      THEN ROUND(t.quantity * COALESCE(t.unit_price_override, p.price), 3)
    ELSE NULL
  END AS amount,
  (t.kind IN ('customer_out','customer_return')
   AND COALESCE(t.unit_price_override, p.price) IS NULL) AS price_pending,
  CASE t.kind
    WHEN 'supply'          THEN  t.quantity
    WHEN 'customer_out'    THEN -t.quantity
    WHEN 'customer_return' THEN  t.quantity
    WHEN 'operator_out'    THEN -t.quantity
    WHEN 'operator_in'     THEN  t.quantity
    ELSE 0
  END AS stock_delta,
  CASE t.kind
    WHEN 'customer_out'    THEN  COALESCE(ROUND(t.quantity * COALESCE(t.unit_price_override, p.price), 3), 0)
    WHEN 'customer_return' THEN -COALESCE(ROUND(t.quantity * COALESCE(t.unit_price_override, p.price), 3), 0)
    WHEN 'payment'         THEN -t.payment_amount
    ELSE 0
  END AS debt_delta
FROM transactions t
LEFT JOIN entities e ON e.id = t.entity_id
LEFT JOIN items    i ON i.id = t.item_id
LEFT JOIN LATERAL (
  SELECT ip.price FROM item_prices ip
  WHERE ip.item_id = t.item_id AND ip.effective_from <= t.occurred_at
  ORDER BY ip.effective_from DESC, ip.id DESC LIMIT 1
) p ON TRUE
WHERE t.deleted_at IS NULL;

CREATE OR REPLACE VIEW v_stock AS
SELECT
  i.id AS item_id, i.name AS item_name, i.unit, i.active,
  COALESCE(SUM(v.stock_delta), 0) AS quantity,
  cp.price AS current_price,
  MAX(v.occurred_at) AS last_movement_at
FROM items i
LEFT JOIN v_transactions v ON v.item_id = i.id
LEFT JOIN LATERAL (
  SELECT ip.price FROM item_prices ip
  WHERE ip.item_id = i.id AND ip.effective_from <= now()
  ORDER BY ip.effective_from DESC, ip.id DESC LIMIT 1
) cp ON TRUE
GROUP BY i.id, i.name, i.unit, i.active, cp.price;

CREATE OR REPLACE VIEW v_balances AS
SELECT
  e.id AS entity_id, e.name AS entity_name, e.type, e.has_financials,
  COALESCE(SUM(v.debt_delta), 0) AS balance,
  COALESCE(SUM(CASE WHEN v.kind = 'customer_out'    THEN v.amount ELSE 0 END), 0) AS total_withdrawn,
  COALESCE(SUM(CASE WHEN v.kind = 'payment'         THEN v.payment_amount ELSE 0 END), 0) AS total_paid,
  COALESCE(SUM(CASE WHEN v.kind = 'customer_return' THEN v.amount ELSE 0 END), 0) AS total_returned,
  COUNT(v.id) FILTER (WHERE v.price_pending) AS pending_price_count
FROM entities e
LEFT JOIN v_transactions v ON v.entity_id = e.id
GROUP BY e.id, e.name, e.type, e.has_financials;

CREATE OR REPLACE FUNCTION entity_period_summary(
  p_entity_id INTEGER, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ
) RETURNS TABLE (
  opening_balance NUMERIC, withdrawals NUMERIC, returns NUMERIC,
  payments NUMERIC, period_change NUMERIC, closing_balance NUMERIC, pending_lines INTEGER
) AS $$
  WITH opening AS (
    SELECT COALESCE(SUM(debt_delta), 0) AS amount FROM v_transactions
    WHERE entity_id = p_entity_id AND occurred_at < p_from
  ),
  period AS (
    SELECT
      COALESCE(SUM(CASE WHEN kind = 'customer_out'    THEN amount ELSE 0 END), 0) AS withdrawals,
      COALESCE(SUM(CASE WHEN kind = 'customer_return' THEN amount ELSE 0 END), 0) AS returns,
      COALESCE(SUM(CASE WHEN kind = 'payment' THEN payment_amount ELSE 0 END), 0) AS payments,
      COALESCE(SUM(debt_delta), 0) AS change,
      COUNT(*) FILTER (WHERE price_pending)::INTEGER AS pending
    FROM v_transactions
    WHERE entity_id = p_entity_id AND occurred_at >= p_from AND occurred_at < p_to
  )
  SELECT ROUND(opening.amount, 3), ROUND(period.withdrawals, 3), ROUND(period.returns, 3),
         ROUND(period.payments, 3), ROUND(period.change, 3),
         ROUND(opening.amount + period.change, 3), period.pending
  FROM opening, period;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE VIEW v_stock_summary AS
SELECT
  COUNT(*)::INTEGER                                      AS total_items,
  COUNT(*) FILTER (WHERE quantity < 0)::INTEGER          AS negative_count,
  COUNT(*) FILTER (WHERE current_price IS NULL)::INTEGER AS missing_price_count,
  ROUND(COALESCE(SUM(CASE WHEN current_price IS NULL THEN 0 ELSE quantity * current_price END), 0), 3) AS total_value
FROM v_stock WHERE active = TRUE;

CREATE OR REPLACE VIEW v_customer_totals AS
SELECT ROUND(COALESCE(SUM(balance), 0), 3)         AS total_balance,
       ROUND(COALESCE(SUM(total_withdrawn), 0), 3) AS total_withdrawn,
       ROUND(COALESCE(SUM(total_paid), 0), 3)      AS total_paid
FROM v_balances WHERE type = 'customer';
