-- ==========================================================================
-- السندات: سند واحد فيه أكتر من صنف
-- ==========================================================================
-- الواقع: عبود بيجهّز طلب زبون فيه ٨ أصناف. تسجيلها حركة حركة يعني ٨ فرص
-- غلط وما في مراجعة قبل التثبيت. السند بيجمعهم بعملية وحدة: بيبني الأسطر،
-- بيراجع الجرد، وبيثبّت - والأسطر بتنحفظ كلها أو ولا وحدة.
--
-- كل سطر بيضل حركة عادية بجدول transactions، فالأرصدة والستوك والكشوفات
-- ما بتتغيّر ولا بتحتاج منطق جديد. السند بس بيجمعهم ويعطيهم رقم.

CREATE SEQUENCE IF NOT EXISTS voucher_no_seq START 1000;

CREATE TABLE IF NOT EXISTS vouchers (
  id          SERIAL PRIMARY KEY,
  voucher_no  BIGINT NOT NULL UNIQUE DEFAULT nextval('voucher_no_seq'),
  kind        txn_kind NOT NULL,
  entity_id   INTEGER REFERENCES entities(id) ON DELETE RESTRICT,
  note        TEXT CHECK (length(note) <= 500),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_token TEXT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at  TIMESTAMPTZ,
  CONSTRAINT voucher_is_goods CHECK (kind <> 'payment'),
  CONSTRAINT voucher_entity_required CHECK (kind = 'supply' OR entity_id IS NOT NULL),
  CONSTRAINT voucher_occurred_sane CHECK (occurred_at >= TIMESTAMPTZ '2020-01-01')
);
CREATE INDEX IF NOT EXISTS idx_vouchers_live ON vouchers (occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vouchers_entity ON vouchers (entity_id, occurred_at DESC);
-- منع ازدواج السند لما ينبعت الطلب مرتين
CREATE UNIQUE INDEX IF NOT EXISTS idx_vouchers_client_token
  ON vouchers (client_token) WHERE client_token IS NOT NULL AND deleted_at IS NULL;

-- ربط الحركة بسندها (الحركات المفردة بتضل بلا سند)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS voucher_id INTEGER REFERENCES vouchers(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_txn_voucher ON transactions (voucher_id) WHERE voucher_id IS NOT NULL;

-- سطر السند لازم يطابق سنده بالنوع والجهة والتاريخ
CREATE OR REPLACE FUNCTION check_voucher_line() RETURNS trigger AS $$
DECLARE v vouchers%ROWTYPE;
BEGIN
  IF NEW.voucher_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v FROM vouchers WHERE id = NEW.voucher_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'السند غير موجود'; END IF;
  IF NEW.kind <> v.kind THEN
    RAISE EXCEPTION 'سطر السند لازم يكون بنفس نوع السند';
  END IF;
  IF NEW.entity_id IS DISTINCT FROM v.entity_id THEN
    RAISE EXCEPTION 'سطر السند لازم يكون على نفس جهة السند';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_voucher_line ON transactions;
CREATE TRIGGER trg_voucher_line
  BEFORE INSERT OR UPDATE OF voucher_id, kind, entity_id ON transactions
  FOR EACH ROW EXECUTE FUNCTION check_voucher_line();

-- رقم السند بيظهر مع الحركة
DROP VIEW IF EXISTS v_customer_totals;
DROP VIEW IF EXISTS v_stock_summary;
DROP VIEW IF EXISTS v_balances;
DROP VIEW IF EXISTS v_stock;
DROP FUNCTION IF EXISTS entity_period_summary(INTEGER, TIMESTAMPTZ, TIMESTAMPTZ);
DROP VIEW IF EXISTS v_transactions;

CREATE VIEW v_transactions AS
SELECT
  t.id, t.kind, t.entity_id,
  e.name AS entity_name, e.type AS entity_type,
  t.item_id, i.name AS item_name, i.unit AS item_unit,
  t.quantity, t.quantity_input, t.payment_amount, t.method, t.note,
  t.occurred_at, t.created_by, t.created_at, t.updated_by, t.updated_at,
  t.client_token, t.voucher_id, vo.voucher_no,
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
    WHEN 'supply' THEN t.quantity WHEN 'customer_out' THEN -t.quantity
    WHEN 'customer_return' THEN t.quantity WHEN 'operator_out' THEN -t.quantity
    WHEN 'operator_in' THEN t.quantity ELSE 0
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
LEFT JOIN vouchers vo ON vo.id = t.voucher_id
LEFT JOIN LATERAL (
  SELECT ip.price FROM item_prices ip
  WHERE ip.item_id = t.item_id AND ip.effective_from <= t.occurred_at
  ORDER BY ip.effective_from DESC, ip.id DESC LIMIT 1
) p ON TRUE
WHERE t.deleted_at IS NULL;

CREATE VIEW v_stock AS
SELECT i.id AS item_id, i.name AS item_name, i.unit, i.active,
  COALESCE(SUM(v.stock_delta), 0) AS quantity,
  cp.price AS current_price, MAX(v.occurred_at) AS last_movement_at
FROM items i
LEFT JOIN v_transactions v ON v.item_id = i.id
LEFT JOIN LATERAL (
  SELECT ip.price FROM item_prices ip
  WHERE ip.item_id = i.id AND ip.effective_from <= now()
  ORDER BY ip.effective_from DESC, ip.id DESC LIMIT 1
) cp ON TRUE
GROUP BY i.id, i.name, i.unit, i.active, cp.price;

CREATE VIEW v_balances AS
SELECT e.id AS entity_id, e.name AS entity_name, e.type, e.has_financials,
  COALESCE(SUM(v.debt_delta), 0) AS balance,
  COALESCE(SUM(CASE WHEN v.kind = 'customer_out'    THEN v.amount ELSE 0 END), 0) AS total_withdrawn,
  COALESCE(SUM(CASE WHEN v.kind = 'payment'         THEN v.payment_amount ELSE 0 END), 0) AS total_paid,
  COALESCE(SUM(CASE WHEN v.kind = 'customer_return' THEN v.amount ELSE 0 END), 0) AS total_returned,
  COUNT(v.id) FILTER (WHERE v.price_pending) AS pending_price_count
FROM entities e
LEFT JOIN v_transactions v ON v.entity_id = e.id
GROUP BY e.id, e.name, e.type, e.has_financials;

CREATE FUNCTION entity_period_summary(
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

CREATE VIEW v_stock_summary AS
SELECT COUNT(*)::INTEGER AS total_items,
  COUNT(*) FILTER (WHERE quantity < 0)::INTEGER AS negative_count,
  COUNT(*) FILTER (WHERE current_price IS NULL)::INTEGER AS missing_price_count,
  ROUND(COALESCE(SUM(CASE WHEN current_price IS NULL THEN 0 ELSE quantity * current_price END), 0), 3) AS total_value
FROM v_stock WHERE active = TRUE;

CREATE VIEW v_customer_totals AS
SELECT ROUND(COALESCE(SUM(balance), 0), 3) AS total_balance,
       ROUND(COALESCE(SUM(total_withdrawn), 0), 3) AS total_withdrawn,
       ROUND(COALESCE(SUM(total_paid), 0), 3) AS total_paid
FROM v_balances WHERE type = 'customer';

-- ملخّص السند: عدد الأسطر وإجمالي الكميات والمبلغ
CREATE VIEW v_vouchers AS
SELECT
  vo.id, vo.voucher_no, vo.kind, vo.entity_id, e.name AS entity_name,
  vo.note, vo.occurred_at, vo.created_by, u.display_name AS created_by_name, vo.created_at,
  COUNT(t.id)::INTEGER AS line_count,
  ROUND(COALESCE(SUM(t.quantity), 0), 3) AS total_quantity,
  ROUND(COALESCE(SUM(t.amount), 0), 3)   AS total_amount,
  COUNT(*) FILTER (WHERE t.price_pending)::INTEGER AS pending_price_lines
FROM vouchers vo
LEFT JOIN entities e ON e.id = vo.entity_id
LEFT JOIN users u ON u.id = vo.created_by
LEFT JOIN v_transactions t ON t.voucher_id = vo.id
WHERE vo.deleted_at IS NULL
GROUP BY vo.id, vo.voucher_no, vo.kind, vo.entity_id, e.name, vo.note,
         vo.occurred_at, vo.created_by, u.display_name, vo.created_at;
