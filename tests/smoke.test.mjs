import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { hashPassword, verifyPassword } from '../lib/admin-auth.mjs';

const SITE_PORT = 4317;
const BASE = `http://127.0.0.1:${SITE_PORT}`;
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
let siteProcess;
let testPool;
let adminUsername = `test-admin-${process.pid}`;

before(async () => {
  if (TEST_DATABASE_URL) {
    const { Pool } = await import('pg');
    testPool = new Pool({
      connectionString: TEST_DATABASE_URL,
      ssl: process.env.TEST_DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined
    });
    const schema = await readFile(new URL('../postgresql-schema.sql', import.meta.url), 'utf8');
    await testPool.query(schema);
    await testPool.query('TRUNCATE public.contacts, public.registrations CASCADE');
    await testPool.query('DELETE FROM public.admin_users WHERE username = $1', [adminUsername]);
    await testPool.query('INSERT INTO public.admin_users (username, password_hash) VALUES ($1, $2)', [adminUsername, await hashPassword('Test-Only-Strong-Password-2026!')]);
  }

  siteProcess = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(SITE_PORT),
      DATABASE_URL: TEST_DATABASE_URL,
      DATABASE_SSL: process.env.TEST_DATABASE_SSL || 'false'
    },
    stdio: 'ignore'
  });

  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(BASE);
      if (response.ok) { ready = true; break; }
    } catch { /* Server is starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.equal(ready, true, 'site server should start');
});

after(async () => {
  if (siteProcess && !siteProcess.killed) siteProcess.kill('SIGTERM');
  if (testPool) {
    await testPool.query('DELETE FROM public.admin_users WHERE username = $1', [adminUsername]).catch(() => {});
    await testPool.end();
  }
});

test('homepage and course page are served', async () => {
  const home = await fetch(BASE);
  const courses = await fetch(`${BASE}/courses`);
  assert.equal(home.status, 200);
  assert.equal(courses.status, 200);
  assert.match(await home.text(), /data-language-toggle/);
  assert.match(await courses.text(), /id="registration"/);
});

test('Phase 2 bilingual editorial content and illustrative images are served', async () => {
  const homeResponse = await fetch(BASE);
  const home = await homeResponse.text();
  const courseResponse = await fetch(`${BASE}/courses`);
  const courses = await courseResponse.text();
  assert.match(home, /Think of your homestead as one connected garden/);
  assert.match(home, /Plan your homestead|Think of your homestead/);
  assert.match(home, /data-en="Keep local crop knowledge growing"/);
  assert.match(home, /info@purayidakrishi.com/);
  assert.match(home, /Shoranur P\.O\./);
  assert.match(courses, /The active batch date, number of sessions/);
  for (const image of ['homestead-garden.webp', 'soil-compost.webp', 'traditional-paddy.webp', 'seedling-nursery.webp']) {
    const response = await fetch(`${BASE}/images/${image}`);
    assert.equal(response.status, 200, `${image} should be served`);
    assert.match(response.headers.get('content-type') || '', /image\/webp/);
  }
});

test('static assets, admin workspace and SEO files are served', async () => {
  const admin = await fetch(`${BASE}/admin`);
  assert.equal(admin.status, 200);
  assert.match(await admin.text(), /id=\"login-form\"/);
  for (const url of ['/css/styles.css', '/js/site.js', '/admin/css/admin.css', '/admin/js/admin.js', '/sitemap.xml', '/robots.txt', '/favicon.svg']) {
    const response = await fetch(`${BASE}${url}`);
    assert.equal(response.status, 200, `${url} should return 200`);
  }
});

test('contact endpoint uses PostgreSQL when configured and safe preview mode otherwise', async () => {
  const response = await fetch(`${BASE}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test Grower', email: 'grower@example.com', subject: 'Workshop', message: 'Please send workshop details.', language: 'en', consent: true })
  });
  if (!TEST_DATABASE_URL) {
    assert.equal(response.status, 503);
    return;
  }
  assert.equal(response.status, 201);
  assert.equal((await response.json()).ok, true);
  const saved = await testPool.query('SELECT name, email, subject, language FROM public.contacts WHERE email = $1', ['grower@example.com']);
  assert.equal(saved.rowCount, 1);
  assert.equal(saved.rows[0].language, 'en');
});

test('course enquiry and optional payment proof use PostgreSQL transactionally', async () => {
  const noFile = new FormData();
  noFile.set('name', 'Test Grower');
  noFile.set('phone', '+919876543210');
  noFile.set('location', 'Pattambi');
  noFile.set('course', 'Homestead Agroecology');
  noFile.set('language', 'ml');
  noFile.set('consent', 'on');
  const first = await fetch(`${BASE}/api/registrations`, { method: 'POST', body: noFile });

  const withFile = new FormData();
  withFile.set('name', 'Test Grower');
  withFile.set('phone', '+919876543211');
  withFile.set('location', 'Pattambi');
  withFile.set('course', 'Homestead Agroecology');
  withFile.set('language', 'en');
  withFile.set('consent', 'on');
  withFile.set('paymentProof', new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], { type: 'image/png' }), 'proof.png');
  const second = await fetch(`${BASE}/api/registrations`, { method: 'POST', body: withFile });

  if (!TEST_DATABASE_URL) {
    assert.equal(first.status, 503);
    assert.equal(second.status, 503);
    return;
  }
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const registrations = await testPool.query("SELECT id, language FROM public.registrations WHERE phone IN ($1, $2) ORDER BY phone", ['+919876543210', '+919876543211']);
  assert.equal(registrations.rowCount, 2);
  const proof = await testPool.query('SELECT content_type, file_size, octet_length(file_data) AS stored_size FROM public.registration_payment_proofs WHERE registration_id = $1', [registrations.rows[1].id]);
  assert.equal(proof.rowCount, 1);
  assert.equal(proof.rows[0].content_type, 'image/png');
  assert.equal(Number(proof.rows[0].stored_size), 12);
});

test('foreign-origin API requests are rejected', async () => {
  const response = await fetch(`${BASE}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
    body: JSON.stringify({})
  });
  assert.equal(response.status, 403);
});


test('admin APIs reject unauthenticated access', async () => {
  const response = await fetch(`${BASE}/api/admin/dashboard`);
  if (!TEST_DATABASE_URL) {
    assert.equal(response.status, 503);
    return;
  }
  assert.equal(response.status, 401);
});

test('admin login, protected data, status updates and CSV export work with PostgreSQL', async (t) => {
  if (!TEST_DATABASE_URL) { t.skip('Set TEST_DATABASE_URL to run live PostgreSQL integration checks.'); return; }
  const login = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: adminUsername, password: 'Test-Only-Strong-Password-2026!' })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'login should set an httpOnly session cookie');

  const dashboard = await fetch(`${BASE}/api/admin/dashboard`, { headers: { Cookie: cookie } });
  assert.equal(dashboard.status, 200);
  assert.equal((await dashboard.json()).ok, true);

  const registrations = await fetch(`${BASE}/api/admin/registrations`, { headers: { Cookie: cookie } });
  assert.equal(registrations.status, 200);
  const rows = (await registrations.json()).registrations;
  assert.ok(rows.length >= 2);
  const target = rows.find((row) => row.phone === '+919876543210');
  assert.ok(target);

  const update = await fetch(`${BASE}/api/admin/registrations/${target.id}/status`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'contacted' })
  });
  assert.equal(update.status, 200);
  assert.equal((await update.json()).record.status, 'contacted');

  const contacts = await fetch(`${BASE}/api/admin/contacts`, { headers: { Cookie: cookie } });
  assert.equal(contacts.status, 200);
  const contactRows = (await contacts.json()).contacts;
  assert.ok(contactRows.length >= 1);

  const exportResponse = await fetch(`${BASE}/api/admin/exports/registrations.csv`, { headers: { Cookie: cookie } });
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-type'), /text\/csv/);
  assert.match(await exportResponse.text(), /Test Grower/);

  const logout = await fetch(`${BASE}/api/admin/logout`, { method: 'POST', headers: { Cookie: cookie } });
  assert.equal(logout.status, 200);
  const afterLogout = await fetch(`${BASE}/api/admin/dashboard`, { headers: { Cookie: cookie } });
  assert.equal(afterLogout.status, 401);
});

test('admin passwords are securely hashed and verified', async () => {
  const encoded = await hashPassword('a-very-strong-test-password');
  assert.match(encoded, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await verifyPassword('a-very-strong-test-password', encoded), true);
  assert.equal(await verifyPassword('incorrect-password', encoded), false);
});
