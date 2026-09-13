-- ==========================================================================
-- دقّة المبالغ: كل جمع مالي بيصير بـ NUMERIC داخل قاعدة البيانات
-- (مش بأرقام JS العشرية اللي بتراكم فروقات بسيطة مع الوقت)
-- ==========================================================================

-- ملخّص فترة لجهة: افتتاحي + حركة الفترة، محسوبة كلها بـ NUMERIC
CREATE OR REPLACE FUNCTION entity_period_summary(
  p_entity_id INTEGER,
  p_from      TIMESTAMPTZ,
  p_to        TIMESTAMPTZ
) RETURNS TABLE (
  opening_balance NUMERIC,
  withdrawals     NUMERIC,
  returns         NUMERIC,
  payments        NUMERIC,
  period_change   NUMERIC,
  closing_balance NUMERIC,
  pending_lines   INTEGER
) AS $$
  WITH opening AS (
    SELECT COALESCE(SUM(debt_delta), 0) AS amount
    FROM v_transactions
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
  SELECT
    ROUND(opening.amount, 2),
    ROUND(period.withdrawals, 2),
    ROUND(period.returns, 2),
    ROUND(period.payments, 2),
    ROUND(period.change, 2),
    ROUND(opening.amount + period.change, 2),
    period.pending
  FROM opening, period;
$$ LANGUAGE sql STABLE;

-- ملخّص الستوك: العدد والقيمة الإجمالية بـ NUMERIC
CREATE OR REPLACE VIEW v_stock_summary AS
SELECT
  COUNT(*)::INTEGER                                            AS total_items,
  COUNT(*) FILTER (WHERE quantity < 0)::INTEGER                AS negative_count,
  COUNT(*) FILTER (WHERE current_price IS NULL)::INTEGER       AS missing_price_count,
  ROUND(COALESCE(SUM(
    CASE WHEN current_price IS NULL THEN 0 ELSE quantity * current_price END
  ), 0), 2)                                                    AS total_value
FROM v_stock
WHERE active = TRUE;

-- إجمالي ديون الزباين
CREATE OR REPLACE VIEW v_customer_totals AS
SELECT
  ROUND(COALESCE(SUM(balance), 0), 2)         AS total_balance,
  ROUND(COALESCE(SUM(total_withdrawn), 0), 2) AS total_withdrawn,
  ROUND(COALESCE(SUM(total_paid), 0), 2)      AS total_paid
FROM v_balances
WHERE type = 'customer';
