-- ==========================================================================
-- تشديد سلامة البيانات على مستوى قاعدة البيانات
-- المبدأ: الكود ممكن يصير فيه غلط، بس القاعدة لازم ترفض البيانات الخربانة
-- مهما كان مصدرها (API، سكربت، أو حدا داخل على القاعدة يدوي).
-- ==========================================================================

-- ---------- ١) نوع الحركة لازم يطابق نوع الجهة ----------
CREATE OR REPLACE FUNCTION check_txn_entity_kind() RETURNS trigger AS $$
DECLARE
  entity_kind entity_type;
BEGIN
  IF NEW.kind = 'supply' THEN
    RETURN NEW;  -- التوريد ما بده جهة
  END IF;

  SELECT type INTO entity_kind FROM entities WHERE id = NEW.entity_id;
  IF entity_kind IS NULL THEN
    RAISE EXCEPTION 'الجهة غير موجودة (id=%)', NEW.entity_id;
  END IF;

  IF NEW.kind IN ('customer_out', 'customer_return', 'payment') AND entity_kind <> 'customer' THEN
    RAISE EXCEPTION 'حركة زبون ما بتنسجّل على جهة داخلية';
  END IF;

  IF NEW.kind IN ('operator_out', 'operator_in') AND entity_kind <> 'operator' THEN
    RAISE EXCEPTION 'حركات المشغل بتنسجّل على المشغل بس';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_txn_entity_kind ON transactions;
CREATE TRIGGER trg_txn_entity_kind
  BEFORE INSERT OR UPDATE OF kind, entity_id ON transactions
  FOR EACH ROW EXECUTE FUNCTION check_txn_entity_kind();

-- ---------- ٢) سجل التدقيق للإضافة فقط ----------
-- ما بينفع حدا يعدّل أو يمسح قيد تدقيق - ولا حتى من لوحة قاعدة البيانات
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'سجل التدقيق للإضافة فقط: ممنوع تعديل أو حذف قيوده';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_no_change ON audit_log;
CREATE TRIGGER trg_audit_no_change
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

DROP TRIGGER IF EXISTS trg_audit_no_truncate ON audit_log;
CREATE TRIGGER trg_audit_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();

-- ---------- ٣) منع الدوران بالمقادير ----------
-- (صنف بيدخل بوصفة نفسه بشكل مباشر أو غير مباشر)
CREATE OR REPLACE FUNCTION check_bom_cycle() RETURNS trigger AS $$
DECLARE
  cycle_found BOOLEAN;
BEGIN
  WITH RECURSIVE uses(item_id, depth) AS (
    SELECT NEW.component_item_id, 0
    UNION ALL
    SELECT ic.component_item_id, uses.depth + 1
    FROM item_components ic
    JOIN uses ON ic.parent_item_id = uses.item_id
    WHERE uses.depth < 25
  )
  SELECT EXISTS (SELECT 1 FROM uses WHERE item_id = NEW.parent_item_id) INTO cycle_found;

  IF cycle_found THEN
    RAISE EXCEPTION 'دوران بالمقادير: الصنف ما بينفع يكون مكوّن حاله (ولا بشكل غير مباشر)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bom_cycle ON item_components;
CREATE TRIGGER trg_bom_cycle
  BEFORE INSERT OR UPDATE ON item_components
  FOR EACH ROW EXECUTE FUNCTION check_bom_cycle();

-- ---------- ٤) تناسق الحذف الناعم ----------
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS delete_fields_together;
ALTER TABLE transactions ADD CONSTRAINT delete_fields_together
  CHECK ((deleted_at IS NULL AND deleted_by IS NULL) OR deleted_at IS NOT NULL);

-- ---------- ٥) تواريخ منطقية ----------
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS occurred_at_sane;
ALTER TABLE transactions ADD CONSTRAINT occurred_at_sane
  CHECK (occurred_at >= TIMESTAMPTZ '2020-01-01');

ALTER TABLE item_prices DROP CONSTRAINT IF EXISTS effective_from_sane;
ALTER TABLE item_prices ADD CONSTRAINT effective_from_sane
  CHECK (effective_from >= TIMESTAMPTZ '2020-01-01');

-- ---------- ٦) منع تكرار الأسماء باختلاف حالة الأحرف والمسافات ----------
-- (الكود بيفحص، بس فحص الكود ممكن يفوته سباق بين طلبين بنفس اللحظة)
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_name_unique
  ON items (lower(btrim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_name_unique
  ON entities (lower(btrim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique
  ON users (lower(btrim(username)));

-- ---------- ٧) حدود نصية (منع إدخال نصوص ضخمة) ----------
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS note_length;
ALTER TABLE transactions ADD CONSTRAINT note_length CHECK (length(note) <= 500);
ALTER TABLE items DROP CONSTRAINT IF EXISTS item_name_length;
ALTER TABLE items ADD CONSTRAINT item_name_length
  CHECK (length(btrim(name)) BETWEEN 1 AND 120);

-- ---------- ٨) فهارس للاستعلامات الأكتر استعمالاً ----------
-- كشف الحساب: حركات جهة معيّنة بفترة
CREATE INDEX IF NOT EXISTS idx_txn_entity_time_live
  ON transactions (entity_id, occurred_at) WHERE deleted_at IS NULL;
-- الستوك: حركات صنف معيّن
CREATE INDEX IF NOT EXISTS idx_txn_item_time_live
  ON transactions (item_id, occurred_at) WHERE deleted_at IS NULL;
-- تقرير الفاقد: حركات المشغل
CREATE INDEX IF NOT EXISTS idx_txn_operator_kinds
  ON transactions (kind, occurred_at) WHERE deleted_at IS NULL AND kind IN ('operator_in', 'operator_out');
-- التنبيهات غير المقروءة
CREATE INDEX IF NOT EXISTS idx_notif_unread
  ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
