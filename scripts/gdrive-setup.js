'use strict';
/**
 * توليد refresh token لجوجل درايف (مرّة وحدة بس).
 *
 * الخطوات:
 *  1) من console.cloud.google.com: أنشئ مشروع → فعّل Google Drive API
 *  2) أنشئ OAuth client من نوع "Desktop app" وخُد Client ID و Client Secret
 *  3) شغّل:  node scripts/gdrive-setup.js <CLIENT_ID> <CLIENT_SECRET>
 *  4) افتح الرابط، وافق، وانسخ الكود اللي بيطلع ولصقه هون
 *  5) حط الـ refresh token بملف .env تحت GDRIVE_REFRESH_TOKEN
 */
const readline = require('readline');

const REDIRECT = 'urn:ietf:wg:oauth:2.0:oob';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

const [clientId, clientSecret] = process.argv.slice(2);
if (!clientId || !clientSecret) {
  console.error('الاستعمال: node scripts/gdrive-setup.js <CLIENT_ID> <CLIENT_SECRET>');
  process.exit(1);
}

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent',
});

console.log('\n١) افتح هذا الرابط بالمتصفح ووافق:\n');
console.log(authUrl);
console.log('\n٢) انسخ الكود اللي بيعطيك إياه جوجل والصقه هون.\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('الكود: ', async (code) => {
  rl.close();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: code.trim(), client_id: clientId, client_secret: clientSecret,
      redirect_uri: REDIRECT, grant_type: 'authorization_code',
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.refresh_token) {
    console.error('\n✖ فشل:', JSON.stringify(json, null, 2));
    process.exit(1);
  }
  console.log('\n✔ تم! حط هذول بملف .env:\n');
  console.log(`GDRIVE_CLIENT_ID=${clientId}`);
  console.log(`GDRIVE_CLIENT_SECRET=${clientSecret}`);
  console.log(`GDRIVE_REFRESH_TOKEN=${json.refresh_token}`);
  console.log('\nوكمان GDRIVE_FOLDER_ID = الجزء الأخير من رابط الفولدر بجوجل درايف.');
});
