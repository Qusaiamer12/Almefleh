-- ==========================================================================
-- بنية الكتالوج: عائلة المنتج + الحجم + أسماء بديلة + سعر الشراء
-- ==========================================================================
-- الواقع بالمستودع: "شطة" عائلة إلها ١١ حجم (٥٠٠غ، ١ك، ٢ك... ١٥ك).
-- عرضها كـ٢٣٣ مربّع مسطّح ما بينفع - لازم عائلة ثم حجم.
-- والأسماء البديلة ضرورية: حدا بيكتب "شطه" وحدا "شطة 5 كيلو" وحدا "شطة5ك".

ALTER TABLE items ADD COLUMN IF NOT EXISTS base TEXT;         -- عائلة المنتج
ALTER TABLE items ADD COLUMN IF NOT EXISTS size NUMERIC(10,3);-- الحجم الرقمي
ALTER TABLE items ADD COLUMN IF NOT EXISTS size_unit TEXT;    -- ك / غ / لتر / كرتون
ALTER TABLE items ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE items ADD COLUMN IF NOT EXISTS cost_price NUMERIC(14,2) CHECK (cost_price >= 0);

-- ---------- تطبيع النص العربي ----------
-- الهدف: "شطه" = "شطة"، "احمد" = "أحمد"، "زهره" = "زهرة"، والتشكيل ما يفرق.
CREATE OR REPLACE FUNCTION ar_normalize(input TEXT) RETURNS TEXT AS $$
  SELECT CASE WHEN input IS NULL THEN NULL ELSE
    btrim(regexp_replace(
      translate(
        lower(input),
        'أإآٱةىئؤًٌٍَُِّْـ',   -- همزات، تاء مربوطة، ألف مقصورة، تشكيل، تطويل
        'اااا' || 'هي' || 'يو' || '' || '' || '' || '' || '' || '' || '' || ''
      ),
      '\s+', ' ', 'g'))
  END;
$$ LANGUAGE sql IMMUTABLE STRICT;

-- فهرس للبحث بالاسم المطبّع
CREATE INDEX IF NOT EXISTS idx_items_name_normalized ON items (ar_normalize(name));
CREATE INDEX IF NOT EXISTS idx_items_base ON items (base) WHERE base IS NOT NULL;
-- فهرس الأسماء البديلة (بحث داخل المصفوفة)
CREATE INDEX IF NOT EXISTS idx_items_aliases ON items USING GIN (aliases);

-- حد منطقي على عدد الأسماء البديلة
ALTER TABLE items DROP CONSTRAINT IF EXISTS aliases_sane;
ALTER TABLE items ADD CONSTRAINT aliases_sane CHECK (array_length(aliases, 1) IS NULL OR array_length(aliases, 1) <= 40);
