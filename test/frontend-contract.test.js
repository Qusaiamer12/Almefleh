'use strict';
/**
 * فحص التعاقد بين ملفات الواجهة.
 * بيمسك أخطاء الربط اللي ما بتبيّن إلا وقت ما المستخدم يضغط الزر:
 * نداء لدالة مش موجودة، أو استيراد اسم مش مُصدَّر.
 * (هيك انكشف إنه api.put ناقصة وزر "حفظ المقادير" مكسور.)
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const JS_DIR = path.join(__dirname, '..', 'public', 'js');

function allFiles(dir = JS_DIR, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) allFiles(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}
const read = (f) => fs.readFileSync(f, 'utf8');
const rel = (f) => path.relative(path.join(__dirname, '..'), f);

/** الأسماء اللي بيصدّرها ملف */
function exportsOf(source) {
  const names = new Set();
  for (const m of source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)) names.add(m[1]);
  for (const m of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  return names;
}

test('كل دالة api بتستعملها الواجهة موجودة فعلاً', () => {
  const apiSource = read(path.join(JS_DIR, 'api.js'));
  const apiBlock = /export const api = \{([\s\S]*?)\n\};/.exec(apiSource);
  assert.ok(apiBlock, 'ما لقيت تعريف api');
  const available = new Set([...apiBlock[1].matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]));

  const missing = [];
  for (const file of allFiles()) {
    for (const m of read(file).matchAll(/\bapi\.(\w+)\s*\(/g)) {
      if (!available.has(m[1])) missing.push(`${rel(file)}: api.${m[1]}()`);
    }
  }
  assert.deepStrictEqual(missing, [], `نداءات لدوال مش موجودة بـ api:\n  ${missing.join('\n  ')}`);
});

test('كل اسم مستورد بين ملفات الواجهة مُصدَّر فعلاً', () => {
  const problems = [];
  for (const file of allFiles()) {
    const source = read(file);
    for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      const target = path.resolve(path.dirname(file), m[2]);
      if (!fs.existsSync(target)) { problems.push(`${rel(file)}: ملف مش موجود ${m[2]}`); continue; }
      const exported = exportsOf(read(target));
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name && !exported.has(name)) problems.push(`${rel(file)}: بيستورد "${name}" من ${m[2]} وهو مش مُصدَّر`);
      }
    }
  }
  assert.deepStrictEqual(problems, [], `مشاكل استيراد:\n  ${problems.join('\n  ')}`);
});

test('كل مسار بتنده عليه الواجهة إله راوتر بالسيرفر', () => {
  const routesDir = path.join(__dirname, '..', 'src', 'routes');
  const mounted = {};
  for (const m of read(path.join(__dirname, '..', 'src', 'app.js'))
    .matchAll(/app\.use\('(\/api\/[\w-]+)', require\('\.\/routes\/([\w-]+)'\)/g)) {
    mounted[m[1]] = m[2];
  }

  const missing = [];
  for (const file of allFiles()) {
    for (const m of read(file).matchAll(/api\.(get|post|patch|put|del)\(\s*[`'"]([^`'"]+)/g)) {
      const url = m[2].split('?')[0];
      if (url === '/api/config') continue; // معرّف بـ app.js مباشرة
      const prefix = Object.keys(mounted).find((p) => url === p || url.startsWith(`${p}/`));
      if (!prefix) { missing.push(`${rel(file)}: ${url} - ما في راوتر مركّب على هذا المسار`); continue; }

      const routerSource = read(path.join(routesDir, `${mounted[prefix]}.js`));
      const sub = url.slice(prefix.length).replace(/\$\{[^}]+\}/g, ':x') || '/';
      const segments = sub.split('/').filter(Boolean);
      const method = m[1] === 'del' ? 'delete' : m[1];
      // بنقارن عدد المقاطع والأجزاء الثابتة مع مسارات الراوتر
      const handled = [...routerSource.matchAll(new RegExp(`router\\.${method}\\('([^']+)'`, 'g'))]
        .map((r) => r[1].split('/').filter(Boolean))
        .some((route) => route.length === segments.length
          && route.every((part, i) => part.startsWith(':') || segments[i] === ':x' || part === segments[i]));
      if (!handled) missing.push(`${rel(file)}: ${method.toUpperCase()} ${url} - ما في معالج بـ routes/${mounted[prefix]}.js`);
    }
  }
  assert.deepStrictEqual(missing, [], `مسارات بلا معالج:\n  ${missing.join('\n  ')}`);
});
