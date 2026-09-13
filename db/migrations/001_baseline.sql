-- ==========================================================================
-- نظام مستودعات المفلح - مخطط قاعدة البيانات (PostgreSQL / Supabase)
-- ==========================================================================
-- ملاحظة تصميمية أساسية:
--   الأرصدة (الستوك والديون) *ما بتنخزن* كأرقام ثابتة، بل بتنحسب من الحركات
--   عن طريق الـ views. هيك أي تعديل أو حذف لحركة قديمة بينعكس تلقائياً على
--   كل التوتالات رجوعاً وللأمام بدون أي إعادة حساب يدوية.
-- ==========================================================================


-- ---------- أنواع ----------
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'recorder', 'viewer', 'customer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE entity_type AS ENUM ('customer', 'operator');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE unit_type AS ENUM ('piece', 'kg');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE txn_kind AS ENUM (
    'supply',          -- توريد للمستودع (بيزيد الستوك)
    'customer_out',    -- سحب زبون (بينقص الستوك + بيزيد الدين)
    'customer_return', -- إرجاع بضاعة من زبون (بيزيد الستوك + بينقص الدين)
    'payment',         -- دفعة من زبون (بينقص الدين فقط)
    'operator_out',    -- إخراج للمشغل (بينقص الستوك، بدون فلوس)
    'operator_in'      -- إدخال من المشغل (بيزيد الستوك، بدون فلوس)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('cash', 'bank', 'check');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE proposal_status AS ENUM ('pending', 'accepted', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- الجهات ----------
CREATE TABLE IF NOT EXISTS entities (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  type          entity_type NOT NULL,
  -- المشغل جهة داخلية: حركاته كمّية فقط بدون أي حساب مالي
  has_financials BOOLEAN NOT NULL DEFAULT TRUE,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- المستخدمين ----------
CREATE TABLE IF NOT EXISTS users (
  id                SERIAL PRIMARY KEY,
  username          TEXT NOT NULL UNIQUE,
  display_name      TEXT NOT NULL,
  role              user_role NOT NULL,
  password_hash     TEXT NOT NULL,
  -- نسخة مشفّرة (AES-256-GCM) عشان الأدمن يقدر يشوف بيانات الدخول
  -- حسب المتطلّب "قصي دايماً شايف يوزر وباسورد كل الحسابات"
  password_enc      TEXT,
  entity_id         INTEGER REFERENCES entities(id) ON DELETE SET NULL,
  notifications_on  BOOLEAN NOT NULL DEFAULT TRUE,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_must_have_entity
    CHECK (role <> 'customer' OR entity_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_users_entity ON users(entity_id);

-- ---------- الأصناف ----------
CREATE TABLE IF NOT EXISTS items (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  unit        unit_type NOT NULL DEFAULT 'piece',
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- تاريخ الأسعار (سعر بتاريخ سريان) ----------
-- سعر الصنف بأي لحظة = آخر سعر تاريخ سريانه <= لحظة الحركة.
-- إذا ما في ولا سعر ساري => الحركة بتضل "سعر معلّق" لحد ما قصي يحدد السعر.
CREATE TABLE IF NOT EXISTS item_prices (
  id             SERIAL PRIMARY KEY,
  item_id        INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  price          NUMERIC(14,2) NOT NULL CHECK (price >= 0),
  effective_from TIMESTAMPTZ NOT NULL,
  note           TEXT,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_item_prices_lookup
  ON item_prices(item_id, effective_from DESC);

-- ---------- المقادير / الوصفة (BOM) ----------
-- كمية المكوّن المطلوبة لإنتاج وحدة واحدة من الصنف الجاهز
CREATE TABLE IF NOT EXISTS item_components (
  id                SERIAL PRIMARY KEY,
  parent_item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  component_item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  quantity_per_unit NUMERIC(14,4) NOT NULL CHECK (quantity_per_unit > 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (parent_item_id, component_item_id),
  CONSTRAINT no_self_component CHECK (parent_item_id <> component_item_id)
);
CREATE INDEX IF NOT EXISTS idx_components_component ON item_components(component_item_id);

-- ---------- الحركات ----------
CREATE TABLE IF NOT EXISTS transactions (
  id                 SERIAL PRIMARY KEY,
  kind               txn_kind NOT NULL,
  entity_id          INTEGER REFERENCES entities(id) ON DELETE RESTRICT,
  item_id            INTEGER REFERENCES items(id) ON DELETE RESTRICT,
  quantity           NUMERIC(14,3) CHECK (quantity > 0),
  -- النص الأصلي اللي كتبه المستخدم للكمية (مثلاً "١٠ك") للتوثيق
  quantity_input     TEXT,
  -- سعر استثنائي لهاي الحركة بس (بيتجاوز سعر الصنف الساري)
  unit_price_override NUMERIC(14,2) CHECK (unit_price_override >= 0),
  payment_amount     NUMERIC(14,2) CHECK (payment_amount > 0),
  method             payment_method,
  note               TEXT,
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at         TIMESTAMPTZ,
  deleted_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at         TIMESTAMPTZ,

  -- حركة بضاعة لازم إلها صنف وكمية، والدفعة لازم إلها مبلغ وطريقة دفع
  CONSTRAINT goods_needs_item CHECK (
    kind = 'payment' OR (item_id IS NOT NULL AND quantity IS NOT NULL)
  ),
  CONSTRAINT payment_needs_amount CHECK (
    kind <> 'payment' OR (payment_amount IS NOT NULL AND method IS NOT NULL
                          AND item_id IS NULL AND quantity IS NULL)
  ),
  -- حركات الزباين والمشغل لازم إلها جهة
  CONSTRAINT entity_required CHECK (kind = 'supply' OR entity_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_txn_occurred  ON transactions(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_txn_entity    ON transactions(entity_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_txn_item      ON transactions(item_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_txn_live      ON transactions(id) WHERE deleted_at IS NULL;

-- ---------- اقتراحات تعديل السعر (لما يتغيّر سعر مكوّن) ----------
CREATE TABLE IF NOT EXISTS price_proposals (
  id                SERIAL PRIMARY KEY,
  parent_item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  component_item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
  old_component_price NUMERIC(14,2),
  new_component_price NUMERIC(14,2),
  current_parent_price NUMERIC(14,2),
  suggested_price   NUMERIC(14,2),        -- الحفاظ على نفس هامش الربح
  cost_price        NUMERIC(14,2),        -- تكلفة المقادير الجديدة
  effective_from    TIMESTAMPTZ NOT NULL, -- تاريخ سريان تغيير سعر المكوّن
  status            proposal_status NOT NULL DEFAULT 'pending',
  decided_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON price_proposals(status, created_at DESC);

-- ---------- طلبات / ملاحظات الزباين ----------
CREATE TABLE IF NOT EXISTS customer_requests (
  id          SERIAL PRIMARY KEY,
  entity_id   INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  handled     BOOLEAN NOT NULL DEFAULT FALSE,
  handled_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  handled_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_requests_open ON customer_requests(handled, created_at DESC);

-- ---------- التنبيهات ----------
CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,       -- negative_stock | price_change | customer_request | ...
  title      TEXT NOT NULL,
  body       TEXT,
  data       JSONB,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at, created_at DESC);

-- ---------- سجل التدقيق ----------
CREATE TABLE IF NOT EXISTS audit_log (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username    TEXT,               -- منسوخ عشان يضل حتى لو انحذف المستخدم
  action      TEXT NOT NULL,      -- create | update | delete | login | ...
  table_name  TEXT NOT NULL,
  record_id   TEXT,
  before_data JSONB,
  after_data  JSONB,
  summary     TEXT,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_record  ON audit_log(table_name, record_id);

-- ---------- إعدادات عامة ----------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==========================================================================
-- Views: كل الأرصدة مشتقّة، مش مخزّنة
-- ==========================================================================

-- سعر الوحدة الفعّال لكل حركة + المبلغ + أثرها على الستوك والدين
CREATE OR REPLACE VIEW v_transactions AS
SELECT
  t.id,
  t.kind,
  t.entity_id,
  e.name              AS entity_name,
  e.type              AS entity_type,
  t.item_id,
  i.name              AS item_name,
  i.unit              AS item_unit,
  t.quantity,
  t.quantity_input,
  t.payment_amount,
  t.method,
  t.note,
  t.occurred_at,
  t.created_by,
  t.created_at,
  t.updated_by,
  t.updated_at,
  COALESCE(t.unit_price_override, p.price) AS unit_price,
  (t.unit_price_override IS NOT NULL)      AS price_overridden,
  CASE
    WHEN t.kind = 'payment' THEN t.payment_amount
    WHEN t.kind IN ('customer_out','customer_return')
      THEN ROUND(t.quantity * COALESCE(t.unit_price_override, p.price), 2)
    ELSE NULL
  END AS amount,
  -- سعر معلّق: حركة زبون بدون سعر ساري للصنف
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
    WHEN 'customer_out'    THEN  COALESCE(ROUND(t.quantity * COALESCE(t.unit_price_override, p.price), 2), 0)
    WHEN 'customer_return' THEN -COALESCE(ROUND(t.quantity * COALESCE(t.unit_price_override, p.price), 2), 0)
    WHEN 'payment'         THEN -t.payment_amount
    ELSE 0
  END AS debt_delta
FROM transactions t
LEFT JOIN entities e ON e.id = t.entity_id
LEFT JOIN items    i ON i.id = t.item_id
LEFT JOIN LATERAL (
  SELECT ip.price
  FROM item_prices ip
  WHERE ip.item_id = t.item_id
    AND ip.effective_from <= t.occurred_at
  ORDER BY ip.effective_from DESC, ip.id DESC
  LIMIT 1
) p ON TRUE
WHERE t.deleted_at IS NULL;

-- الستوك اللحظي لكل صنف
CREATE OR REPLACE VIEW v_stock AS
SELECT
  i.id   AS item_id,
  i.name AS item_name,
  i.unit,
  i.active,
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

-- رصيد (دين) كل زبون
CREATE OR REPLACE VIEW v_balances AS
SELECT
  e.id   AS entity_id,
  e.name AS entity_name,
  e.type,
  e.has_financials,
  COALESCE(SUM(v.debt_delta), 0) AS balance,
  COALESCE(SUM(CASE WHEN v.kind = 'customer_out'    THEN v.amount ELSE 0 END), 0) AS total_withdrawn,
  COALESCE(SUM(CASE WHEN v.kind = 'payment'         THEN v.payment_amount ELSE 0 END), 0) AS total_paid,
  COALESCE(SUM(CASE WHEN v.kind = 'customer_return' THEN v.amount ELSE 0 END), 0) AS total_returned,
  COUNT(v.id) FILTER (WHERE v.price_pending) AS pending_price_count
FROM entities e
LEFT JOIN v_transactions v ON v.entity_id = e.id
GROUP BY e.id, e.name, e.type, e.has_financials;

