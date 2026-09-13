'use strict';
/**
 * تحقّق صارم من المدخلات.
 *
 * المبدأ: ما بنمرّر شي للقاعدة إلا بعد ما نتأكد من نوعه وحدوده.
 * الحقول اللي مش بالمخطّط بتنرفض (مش بتنتجاهل) - عشان غلطة إملائية
 * بالواجهة ما تمرّ بصمت وتضيع بيانات.
 */

class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
    this.field = field;
  }
}

const isMissing = (value) => value === undefined || value === null || value === '';

const CHECKERS = {
  string(value, rule, label) {
    const text = String(value).trim();
    if (rule.minLength && text.length < rule.minLength) {
      throw new ValidationError(`${label}: لازم ${rule.minLength} خانات على الأقل`, label);
    }
    if (rule.maxLength && text.length > rule.maxLength) {
      throw new ValidationError(`${label}: أطول من المسموح (${rule.maxLength} حرف)`, label);
    }
    if (rule.pattern && !rule.pattern.test(text)) {
      throw new ValidationError(`${label}: صيغة غير صالحة`, label);
    }
    return text;
  },

  int(value, rule, label) {
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isInteger(n)) throw new ValidationError(`${label}: لازم يكون رقم صحيح`, label);
    return CHECKERS._range(n, rule, label);
  },

  number(value, rule, label) {
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(n)) throw new ValidationError(`${label}: لازم يكون رقم`, label);
    return CHECKERS._range(n, rule, label);
  },

  _range(n, rule, label) {
    if (rule.min !== undefined && n < rule.min) {
      throw new ValidationError(`${label}: لازم يكون ${rule.min} أو أكتر`, label);
    }
    if (rule.max !== undefined && n > rule.max) {
      throw new ValidationError(`${label}: لازم يكون ${rule.max} أو أقل`, label);
    }
    return n;
  },

  boolean(value, _rule, label) {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === 1 || value === '1') return true;
    if (value === 'false' || value === 0 || value === '0') return false;
    throw new ValidationError(`${label}: لازم تكون صح أو خطأ`, label);
  },

  enum(value, rule, label) {
    const text = String(value).trim();
    if (!rule.values.includes(text)) {
      throw new ValidationError(`${label}: قيمة غير معروفة`, label);
    }
    return text;
  },

  date(value, rule, label) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationError(`${label}: تاريخ غير صالح`, label);
    const year = date.getUTCFullYear();
    if (year < 2020 || year > 2100) {
      throw new ValidationError(`${label}: تاريخ خارج المدى المنطقي`, label);
    }
    if (rule.maxFutureDays !== undefined) {
      const limit = Date.now() + rule.maxFutureDays * 86400000;
      if (date.getTime() > limit) {
        throw new ValidationError(`${label}: ما بينفع تاريخ بالمستقبل`, label);
      }
    }
    return date;
  },
};

/**
 * @param {object} input   جسم الطلب
 * @param {object} schema  {field: {type, required, label, ...constraints}}
 * @param {{allowUnknown?: boolean}} options
 */
function validate(input, schema, { allowUnknown = false } = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('البيانات المرسلة غير صالحة');
  }

  if (!allowUnknown) {
    const known = new Set(Object.keys(schema));
    const unknown = Object.keys(input).filter((key) => !known.has(key));
    if (unknown.length) {
      throw new ValidationError(`حقول غير معروفة بالطلب: ${unknown.join('، ')}`);
    }
  }

  const output = {};
  for (const [field, rule] of Object.entries(schema)) {
    const label = rule.label || field;
    const raw = input[field];

    if (isMissing(raw)) {
      if (rule.required) throw new ValidationError(`${label}: مطلوب`, label);
      if (rule.default !== undefined) output[field] = rule.default;
      else if (field in input) output[field] = null; // إرسال null صراحةً = تفريغ الحقل
      continue;
    }

    const checker = CHECKERS[rule.type];
    if (!checker) throw new Error(`نوع تحقق غير معروف: ${rule.type}`);
    output[field] = checker(raw, rule, label);
  }
  return output;
}

/** تحقّق من معاملات الرابط (query) - أخف، بيتجاهل الزيادة */
function validateQuery(query, schema) {
  return validate(query, schema, { allowUnknown: true });
}

/**
 * معرّف من مسار الرابط (/api/items/:id).
 * بيرمي 400 برسالة واضحة بدل ما يوصل NaN لقاعدة البيانات.
 */
function parseId(value, label = 'المعرّف') {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new ValidationError(`${label} غير صالح`, label);
  }
  return n;
}

module.exports = { validate, validateQuery, parseId, ValidationError };
