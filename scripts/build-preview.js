'use strict';
/**
 * بناء نسخة تجريبية بملف HTML واحد.
 *
 * بياخد *نفس* ملفات الواجهة الحقيقية ويحطها بملف واحد، وبيبدّل طبقة
 * الاتصال بالسيرفر بسيرفر وهمي بالذاكرة. يعني اللي بتشوفه بالتجربة هو
 * نفس الواجهة والمنطق، بدون Node ولا قاعدة بيانات.
 *
 *   node scripts/build-preview.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JS = (f) => path.join(ROOT, 'public', 'js', f);

// الترتيب مهم: الوحدة لازم تيجي بعد اللي بتعتمد عليه
const MODULES = [
  { name: 'icons', file: JS('icons.js') },
  { name: 'ui', file: JS('ui.js') },
  { name: 'api', file: path.join(ROOT, 'preview', 'mock-api.js') },
  { name: 'shared', file: JS('pages/shared.js') },
  { name: 'login', file: JS('pages/login.js') },
  { name: 'admin', file: JS('pages/admin.js') },
  { name: 'record', file: JS('pages/record.js') },
  { name: 'overview', file: JS('pages/overview.js') },
  { name: 'customer', file: JS('pages/customer.js') },
  { name: 'app', file: JS('app.js') },
];

/** التعريفات بالمستوى الأعلى (بداية السطر بلا مسافة) */
function topLevelNames(source) {
  const names = new Set();
  for (const m of source.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/gm)) {
    names.add(m[1]);
  }
  return names;
}

function stripModuleSyntax(source) {
  return source
    // بتشيل الـ import حتى لو ممتد على أكتر من سطر
    .replace(/^import\s+[\s\S]*?\bfrom\s*['"][^'"]*['"]\s*;?/gm, '')
    .replace(/^import\s*['"][^'"]*['"]\s*;?/gm, '')
    .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '')  // export { x }
    .replace(/^export\s+/gm, '');                   // export const/function
}

function build() {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'app.css'), 'utf8');
  const svg = fs.readFileSync(path.join(ROOT, 'public', 'assets', 'logo.svg'), 'utf8');
  const logoDataUri = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;

  // كشف تعارض الأسماء بين الوحدات (بعد الدمج كلها بنطاق واحد)
  const seen = new Map();
  const renames = new Map(); // module -> Map(old -> new)
  for (const mod of MODULES) {
    const source = fs.readFileSync(mod.file, 'utf8');
    for (const name of topLevelNames(source)) {
      if (seen.has(name)) {
        const newName = `${name}_${mod.name}`;
        if (!renames.has(mod.name)) renames.set(mod.name, new Map());
        renames.get(mod.name).set(name, newName);
      } else {
        seen.set(name, mod.name);
      }
    }
  }

  const parts = [];
  for (const mod of MODULES) {
    let source = stripModuleSyntax(fs.readFileSync(mod.file, 'utf8'));
    for (const [oldName, newName] of (renames.get(mod.name) || new Map())) {
      source = source.replace(new RegExp(`\\b${oldName}\\b`, 'g'), newName);
    }
    if (mod.name === 'api') {
      // حقن الكتالوج الحقيقي بدل المصفوفة الفاضية
      const catalogFile = path.join(ROOT, 'preview', 'catalog.json');
      const catalog = fs.existsSync(catalogFile) ? fs.readFileSync(catalogFile, 'utf8') : '[]';
      source = source.replace('/*__CATALOG__*/ []', catalog);
    }
    if (mod.name === 'ui') {
      source = source.replace("logo: '/assets/logo'", `logo: '${logoDataUri}'`);
    }
    parts.push(`\n// ===== ${path.relative(ROOT, mod.file)} =====\n${source.trim()}\n`);
  }

  const collisions = [...renames.entries()].flatMap(([m, map]) => [...map].map(([o, n]) => `${m}: ${o} -> ${n}`));

  // فحص صياغة: أي خطأ بالدمج لازم يوقف البناء مش يطلع ملف مكسور
  const bundle = parts.join('\n');
  try {
    new Function(bundle); // eslint-disable-line no-new-func
  } catch (err) {
    throw new Error(`الحزمة المدموجة فيها خطأ صياغة: ${err.message}\n` +
      'غالباً وحدة ما انشالت منها صيغة الـ import/export صح.');
  }


  const body = `<title>مستودعات المفلح</title>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@700;800&family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap">
  <style>
${css}
/* ===== شريط النسخة التجريبية ===== */
.demo-bar {
  position: fixed; bottom: 0; inset-inline: 0; z-index: 100;
  background: var(--brand-deep); color: #fff; padding: 8px 14px;
  display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
  font-size: 13px; border-top: 2px solid var(--gold);
}
.demo-bar b { color: var(--gold); }
.demo-bar code {
  background: rgba(255,255,255,.12); padding: 2px 7px; border-radius: 6px;
  font-family: inherit; cursor: pointer; border: 1px solid rgba(255,255,255,.18);
}
.demo-bar code:hover { background: rgba(255,255,255,.25); }
.demo-bar .grow { flex: 1; }
.demo-bar button {
  background: var(--gold); color: var(--brand-deep); border: none;
  border-radius: 7px; padding: 5px 12px; cursor: pointer; font-weight: 700;
}
body { padding-bottom: 46px; }
/* شريط السند بيقعد فوق شريط النسخة التجريبية (بالنظام الحقيقي ما في شريط تجريبي) */
.voucher-bar { inset-block-end: 46px; }
body.has-voucher-bar .content { padding-bottom: 158px; }
#toasts { inset-block-end: 62px; }
body.has-voucher-bar #toasts { inset-block-end: 138px; }
@media (max-width: 720px) { .demo-bar { font-size: 12px; } }
</style>

  <div id="app"><div class="empty">جاري التحميل…</div></div>
  <div id="toasts"></div>

  <div class="demo-bar">
    <b>نسخة تجريبية</b>
    <span>البيانات بالذاكرة — أي تحديث للصفحة بيرجّع كل شي لأول الطريق</span>
    <span class="grow"></span>
    <span>جرّب الحسابات:</span>
    <code data-user="qusai" data-pass="Admin@1234">قصي (مدير)</code>
    <code data-user="abood" data-pass="Almefleh@2024">عبود (تسجيل)</code>
    <code data-user="abublal" data-pass="Almefleh@2024">أبو بلال (اطّلاع)</code>
    <code data-user="blal" data-pass="Almefleh@2024">بلال (زبون)</code>
  </div>

  <script type="module">
${bundle}

// ===== دخول سريع للتجربة =====
document.querySelectorAll('.demo-bar code').forEach((chip) => {
  chip.addEventListener('click', async () => {
    const username = chip.dataset.user;
    const password = chip.dataset.pass;
    const userField = document.querySelector('input[name=username]');
    if (userField) {
      // على شاشة الدخول: بنعبّي الخانات ونضغط دخول
      userField.value = username;
      document.querySelector('input[name=password]').value = password;
      document.querySelector('form button[type=submit]').click();
    } else {
      // داخل النظام: بنطلع وبندخل بالحساب الجديد
      await api.logout();
      await api.login(username, password);
      location.reload();
    }
  });
});
  </script>
`;

  // ملف مستقل بيفتح بأي متصفح بلا سيرفر
  const standalone = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#0B3D2C">
  <link rel="icon" href="${logoDataUri}">
${body}
</body>
</html>
`;

  const outDir = path.join(ROOT, 'preview');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'almefleh-preview.html');
  fs.writeFileSync(outFile, standalone, 'utf8');
  // نسخة بلا غلاف المستند (للنشر كصفحة)
  const bodyFile = path.join(outDir, 'almefleh-preview.body.html');
  fs.writeFileSync(bodyFile, body, 'utf8');

  return { outFile, bodyFile, size: Buffer.byteLength(standalone), collisions };
}

if (require.main === module) {
  const { outFile, bodyFile, size, collisions } = build();
  if (collisions.length) {
    console.log('أسماء متعارضة انعاد تسميتها تلقائياً:');
    for (const c of collisions) console.log('  ·', c);
  }
  console.log(`✔ ${path.relative(process.cwd(), outFile)} (${Math.round(size / 1024)} كيلوبايت) - ملف مستقل`);
  console.log(`✔ ${path.relative(process.cwd(), bodyFile)} - للنشر كصفحة`);
}

module.exports = { build };
