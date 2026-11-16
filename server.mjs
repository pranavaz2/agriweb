import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSessionToken, hashSessionToken, parseCookies, verifyPassword } from './lib/admin-auth.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');

async function loadLocalEnv() {
  try {
    const contents = await fs.readFile(path.join(ROOT, '.env'), 'utf8');
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim().replace(/^export\s+/, '');
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not read .env file:', error.message);
  }
}

await loadLocalEnv();

const PORT = Number(process.env.PORT || 3000);
const MAX_BODY_BYTES = 7 * 1024 * 1024;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 10;
const rateBuckets = new Map();
let postgresPoolInstance = null;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf'
};

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
}

function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function isRateLimited(req) {
  const address = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const current = rateBuckets.get(address);
  if (!current || now - current.startedAt > RATE_WINDOW_MS) {
    rateBuckets.set(address, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > RATE_LIMIT;
}

async function readRequestBody(req, limit = MAX_BODY_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function getPostgresPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;

  try {
    const parsed = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) return null;
  } catch {
    return null;
  }

  if (!postgresPoolInstance) {
    // Load pg only when a database URL is configured. The static site can still
    // run in preview mode without installed credentials or a database service.
    const { Pool } = await import('pg');
    postgresPoolInstance = new Pool({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      ssl: process.env.DATABASE_SSL === 'true'
        ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
        : undefined
    });
    postgresPoolInstance.on('error', (error) => {
      console.error('Unexpected PostgreSQL pool error:', error.code || 'unknown');
    });
  }

  return postgresPoolInstance;
}

async function insertContact(pool, contact) {
  await pool.query(
    `INSERT INTO contacts (name, email, subject, message, language, status, consent_at)
     VALUES ($1, $2, $3, $4, $5, 'new', now())`,
    [contact.name, contact.email, contact.subject, contact.message, contact.language]
  );
}

async function validatePaymentProof(file) {
  const extensionByType = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf'
  };
  if (!file || !extensionByType[file.type]) throw new Error('Unsupported proof type');
  if (file.size > 5 * 1024 * 1024) throw new Error('Proof file is too large');

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const signatures = {
    'image/jpeg': fileBuffer.length >= 3 && fileBuffer[0] === 0xff && fileBuffer[1] === 0xd8 && fileBuffer[2] === 0xff,
    'image/png': fileBuffer.length >= 8 && fileBuffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'image/webp': fileBuffer.length >= 12 && fileBuffer.toString('ascii', 0, 4) === 'RIFF' && fileBuffer.toString('ascii', 8, 12) === 'WEBP',
    'application/pdf': fileBuffer.length >= 5 && fileBuffer.toString('ascii', 0, 5) === '%PDF-'
  };
  if (!signatures[file.type]) throw new Error('File content does not match its declared type');

  const safeName = String(file.name || `payment-proof.${extensionByType[file.type]}`)
    .replace(/[^a-zA-Z0-9._ -]/g, '_')
    .slice(0, 160);
  return {
    originalName: safeName,
    contentType: file.type,
    size: fileBuffer.length,
    data: fileBuffer
  };
}

async function insertRegistration(pool, registration, proof) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO registrations
        (name, phone, location, email, course, language, status, consent_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'enquiry_received', now())
       RETURNING id`,
      [registration.name, registration.phone, registration.location, registration.email,
        registration.course, registration.language]
    );

    if (proof) {
      await client.query(
        `INSERT INTO registration_payment_proofs
          (registration_id, original_filename, content_type, file_size, file_data)
         VALUES ($1, $2, $3, $4, $5)`,
        [result.rows[0].id, proof.originalName, proof.contentType, proof.size, proof.data]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function handleContact(req, res) {
  if (isRateLimited(req)) return sendJSON(res, 429, { ok: false, error: 'Too many requests. Please try again later.' });
  let pool;
  try { pool = await getPostgresPool(); }
  catch (error) { console.error('Could not initialize PostgreSQL:', error.code || error.message); }
  if (!pool) return sendJSON(res, 503, { ok: false, error: 'Contact service is not configured. Add a valid PostgreSQL DATABASE_URL.' });

  let payload;
  try {
    const body = await readRequestBody(req, 24000);
    payload = JSON.parse(body.toString('utf8'));
  } catch (error) {
    return sendJSON(res, error.statusCode || 400, { ok: false, error: 'Invalid request body.' });
  }

  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim();
  const subject = String(payload.subject || '').trim();
  const message = String(payload.message || '').trim();
  const language = payload.language === 'en' ? 'en' : 'ml';
  if (payload.consent !== true || name.length < 2 || name.length > 120 || !validEmail(email) || subject.length < 2 || subject.length > 180 || message.length < 5 || message.length > 3000) {
    return sendJSON(res, 400, { ok: false, error: 'Please check the submitted fields.' });
  }

  try {
    await insertContact(pool, { name, email, subject, message, language });
    return sendJSON(res, 201, { ok: true });
  } catch (error) {
    console.error('PostgreSQL contact insert failed:', error.code || 'unknown');
    return sendJSON(res, 502, { ok: false, error: 'The contact service could not save your message.' });
  }
}

async function handleRegistration(req, res) {
  if (isRateLimited(req)) return sendJSON(res, 429, { ok: false, error: 'Too many requests. Please try again later.' });
  let pool;
  try { pool = await getPostgresPool(); }
  catch (error) { console.error('Could not initialize PostgreSQL:', error.code || error.message); }
  if (!pool) return sendJSON(res, 503, { ok: false, error: 'Registration service is not configured. Add a valid PostgreSQL DATABASE_URL.' });

  const contentType = req.headers['content-type'] || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return sendJSON(res, 415, { ok: false, error: 'Expected a multipart form.' });
  }

  let form;
  try {
    const body = await readRequestBody(req, MAX_BODY_BYTES);
    const webRequest = new Request('http://localhost/course-registration', {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body
    });
    form = await webRequest.formData();
  } catch (error) {
    return sendJSON(res, error.statusCode || 400, { ok: false, error: 'Invalid registration form.' });
  }

  const name = String(form.get('name') || '').trim();
  const phone = String(form.get('phone') || '').trim();
  const location = String(form.get('location') || '').trim();
  const email = String(form.get('email') || '').trim();
  const course = String(form.get('course') || 'Homestead Agroecology Certification Programme').trim().slice(0, 180);
  const language = form.get('language') === 'en' ? 'en' : 'ml';
  if (form.get('consent') !== 'on' || name.length < 2 || name.length > 120 || phone.length < 8 || phone.length > 20 || location.length < 2 || location.length > 160 || (email && !validEmail(email))) {
    return sendJSON(res, 400, { ok: false, error: 'Please check the submitted fields.' });
  }

  const proofFile = form.get('paymentProof');
  let proof = null;
  if (proofFile && typeof proofFile === 'object' && typeof proofFile.arrayBuffer === 'function' && proofFile.size > 0) {
    try {
      proof = await validatePaymentProof(proofFile);
    } catch (error) {
      return sendJSON(res, 400, { ok: false, error: 'The payment proof file is not supported, does not match its file type, or is too large.' });
    }
  }

  try {
    await insertRegistration(pool, { name, phone, location, email: email || null, course, language }, proof);
    return sendJSON(res, 201, { ok: true });
  } catch (error) {
    console.error('PostgreSQL registration insert failed:', error.code || 'unknown');
    return sendJSON(res, 502, { ok: false, error: 'The registration service could not save your enquiry.' });
  }
}


const ADMIN_COOKIE = 'pk_admin_session';
const ADMIN_SESSION_HOURS = 8;
const REGISTRATION_STATUSES = new Set(['enquiry_received', 'contacted', 'payment_pending', 'confirmed', 'enrolled', 'rejected']);
const CONTACT_STATUSES = new Set(['new', 'in_progress', 'resolved', 'spam']);


async function getAdminSession(req, pool) {
  const token = parseCookies(req.headers.cookie)[ADMIN_COOKIE];
  if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const result = await pool.query(
    `SELECT u.id, u.username, s.token_hash
       FROM public.admin_sessions s
       JOIN public.admin_users u ON u.id = s.admin_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
      LIMIT 1`,
    [hashSessionToken(token)]
  );
  return result.rows[0] || null;
}

async function requireAdmin(req, res, pool) {
  try {
    const admin = await getAdminSession(req, pool);
    if (!admin) {
      sendJSON(res, 401, { ok: false, error: 'Please sign in to continue.' });
      return null;
    }
    return admin;
  } catch (error) {
    console.error('Admin session lookup failed:', error.code || 'unknown');
    sendJSON(res, 503, { ok: false, error: 'Admin database tables are unavailable. Apply admin-schema.sql.' });
    return null;
  }
}

async function readJSON(req, limit = 16000) {
  const raw = await readRequestBody(req, limit);
  try { return JSON.parse(raw.toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 }); }
}

async function handleAdminSession(req, res) {
  let pool;
  try { pool = await getPostgresPool(); }
  catch (error) { console.error('Could not initialize PostgreSQL:', error.code || 'unknown'); }
  if (!pool) return sendJSON(res, 503, { ok: false, error: 'PostgreSQL is not configured.' });
  try {
    const admin = await getAdminSession(req, pool);
    return sendJSON(res, 200, { ok: true, authenticated: Boolean(admin), user: admin ? { username: admin.username } : null });
  } catch (error) {
    console.error('Admin session check failed:', error.code || 'unknown');
    return sendJSON(res, 503, { ok: false, error: 'Admin tables are not installed. Apply admin-schema.sql.' });
  }
}

async function handleAdminLogin(req, res) {
  if (isRateLimited(req)) return sendJSON(res, 429, { ok: false, error: 'Too many sign-in attempts. Try again later.' });
  let pool;
  try { pool = await getPostgresPool(); }
  catch (error) { console.error('Could not initialize PostgreSQL:', error.code || 'unknown'); }
  if (!pool) return sendJSON(res, 503, { ok: false, error: 'PostgreSQL is not configured.' });

  let payload;
  try { payload = await readJSON(req, 4000); }
  catch (error) { return sendJSON(res, error.statusCode || 400, { ok: false, error: 'Invalid sign-in request.' }); }
  const username = String(payload.username || '').trim().toLowerCase();
  const password = String(payload.password || '');
  if (!/^[a-z0-9._-]{3,50}$/.test(username) || password.length < 1 || password.length > 200) {
    return sendJSON(res, 401, { ok: false, error: 'Invalid username or password.' });
  }

  try {
    const result = await pool.query(
      'SELECT id, username, password_hash FROM public.admin_users WHERE lower(username) = $1 LIMIT 1',
      [username]
    );
    const user = result.rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return sendJSON(res, 401, { ok: false, error: 'Invalid username or password.' });
    }

    const token = createSessionToken();
    const tokenHash = hashSessionToken(token);
    await pool.query(
      `INSERT INTO public.admin_sessions (token_hash, admin_id, expires_at)
       VALUES ($1, $2, now() + ($3 * interval '1 hour'))`,
      [tokenHash, user.id, ADMIN_SESSION_HOURS]
    );
    await pool.query('UPDATE public.admin_users SET last_login_at = now() WHERE id = $1', [user.id]);
    res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_SESSION_HOURS * 3600}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    return sendJSON(res, 200, { ok: true, user: { username: user.username } });
  } catch (error) {
    console.error('Admin login failed:', error.code || 'unknown');
    return sendJSON(res, 503, { ok: false, error: 'Admin login is unavailable. Check the admin schema and database connection.' });
  }
}

async function handleAdminLogout(req, res) {
  let pool;
  try { pool = await getPostgresPool(); }
  catch (error) { console.error('Could not initialize PostgreSQL:', error.code || 'unknown'); }
  if (pool) {
    try {
      const token = parseCookies(req.headers.cookie)[ADMIN_COOKIE];
      if (token) await pool.query('DELETE FROM public.admin_sessions WHERE token_hash = $1', [hashSessionToken(token)]);
    } catch (error) { console.error('Admin logout failed:', error.code || 'unknown'); }
  }
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  return sendJSON(res, 200, { ok: true });
}

async function handleAdminDashboard(req, res, pool) {
  const admin = await requireAdmin(req, res, pool);
  if (!admin) return;
  try {
    const [registrations, contacts, proofs, fresh, registrationStatuses] = await Promise.all([
      pool.query('SELECT count(*)::int AS total FROM public.registrations'),
      pool.query('SELECT count(*)::int AS total FROM public.contacts'),
      pool.query('SELECT count(*)::int AS total FROM public.registration_payment_proofs'),
      pool.query("SELECT count(*)::int AS total FROM public.registrations WHERE created_at >= now() - interval '7 days'"),
      pool.query('SELECT status, count(*)::int AS total FROM public.registrations GROUP BY status')
    ]);
    return sendJSON(res, 200, {
      ok: true,
      stats: {
        registrations: registrations.rows[0].total,
        contacts: contacts.rows[0].total,
        paymentProofs: proofs.rows[0].total,
        last7Days: fresh.rows[0].total,
        registrationStatuses: registrationStatuses.rows
      }
    });
  } catch (error) {
    console.error('Admin dashboard query failed:', error.code || 'unknown');
    return sendJSON(res, 502, { ok: false, error: 'Could not load dashboard data.' });
  }
}

async function handleAdminRegistrations(req, res, pool, url) {
  const admin = await requireAdmin(req, res, pool);
  if (!admin) return;
  const query = String(url.searchParams.get('q') || '').trim().slice(0, 100);
  const status = String(url.searchParams.get('status') || '').trim();
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)));
  const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
  if (status && !REGISTRATION_STATUSES.has(status)) return sendJSON(res, 400, { ok: false, error: 'Invalid registration status filter.' });
  try {
    const result = await pool.query(
      `SELECT r.id, r.created_at, r.name, r.phone, r.location, r.email, r.course,
              r.language, r.status,
              (p.registration_id IS NOT NULL) AS has_payment_proof,
              p.original_filename AS proof_filename, p.content_type AS proof_content_type
         FROM public.registrations r
         LEFT JOIN public.registration_payment_proofs p ON p.registration_id = r.id
        WHERE ($1 = '' OR r.status = $1)
          AND ($2 = '' OR r.name ILIKE '%' || $2 || '%' OR r.phone ILIKE '%' || $2 || '%'
               OR coalesce(r.email, '') ILIKE '%' || $2 || '%' OR r.location ILIKE '%' || $2 || '%'
               OR r.course ILIKE '%' || $2 || '%')
        ORDER BY r.created_at DESC
        LIMIT $3 OFFSET $4`,
      [status, query, limit, offset]
    );
    const count = await pool.query(
      `SELECT count(*)::int AS total FROM public.registrations r
        WHERE ($1 = '' OR r.status = $1)
          AND ($2 = '' OR r.name ILIKE '%' || $2 || '%' OR r.phone ILIKE '%' || $2 || '%'
               OR coalesce(r.email, '') ILIKE '%' || $2 || '%' OR r.location ILIKE '%' || $2 || '%'
               OR r.course ILIKE '%' || $2 || '%')`,
      [status, query]
    );
    return sendJSON(res, 200, { ok: true, registrations: result.rows, total: count.rows[0].total, limit, offset });
  } catch (error) {
    console.error('Admin registrations query failed:', error.code || 'unknown');
    return sendJSON(res, 502, { ok: false, error: 'Could not load registrations.' });
  }
}

async function handleAdminContacts(req, res, pool, url) {
  const admin = await requireAdmin(req, res, pool);
  if (!admin) return;
  const query = String(url.searchParams.get('q') || '').trim().slice(0, 100);
  const status = String(url.searchParams.get('status') || '').trim();
  if (status && !CONTACT_STATUSES.has(status)) return sendJSON(res, 400, { ok: false, error: 'Invalid contact status filter.' });
  try {
    const result = await pool.query(
      `SELECT id, created_at, name, email, subject, message, language, status
         FROM public.contacts
        WHERE ($1 = '' OR status = $1)
          AND ($2 = '' OR name ILIKE '%' || $2 || '%' OR email ILIKE '%' || $2 || '%'
               OR subject ILIKE '%' || $2 || '%' OR message ILIKE '%' || $2 || '%')
        ORDER BY created_at DESC LIMIT 100`,
      [status, query]
    );
    return sendJSON(res, 200, { ok: true, contacts: result.rows });
  } catch (error) {
    console.error('Admin contacts query failed:', error.code || 'unknown');
    return sendJSON(res, 502, { ok: false, error: 'Could not load contact enquiries.' });
  }
}

async function handleAdminStatusUpdate(req, res, pool, table, id, allowedStatuses) {
  const admin = await requireAdmin(req, res, pool);
  if (!admin) return;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return sendJSON(res, 400, { ok: false, error: 'Invalid record ID.' });
  }
  let payload;
  try { payload = await readJSON(req, 3000); }
  catch { return sendJSON(res, 400, { ok: false, error: 'Invalid status update.' }); }
  const status = String(payload.status || '');
  if (!allowedStatuses.has(status)) return sendJSON(res, 400, { ok: false, error: 'Invalid status.' });
  try {
    const result = await pool.query(`UPDATE public.${table} SET status = $1 WHERE id = $2 RETURNING id, status`, [status, id]);
    if (!result.rowCount) return sendJSON(res, 404, { ok: false, error: 'Record not found.' });
    return sendJSON(res, 200, { ok: true, record: result.rows[0] });
  } catch (error) {
    console.error(`Admin ${table} status update failed:`, error.code || 'unknown');
    return sendJSON(res, 502, { ok: false, error: 'Could not update this record.' });
  }
}

async function handleAdminPaymentProof(req, res, pool, registrationId) {
  const admin = await requireAdmin(req, res, pool);
  if (!admin) return;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(registrationId)) {
    return sendJSON(res, 400, { ok: false, error: 'Invalid registration ID.' });
  }
  try {
    const result = await pool.query(
      `SELECT original_filename, content_type, file_data
         FROM public.registration_payment_proofs WHERE registration_id = $1`,
      [registrationId]
    );
    if (!result.rowCount) return sendJSON(res, 404, { ok: false, error: 'No payment proof was uploaded for this registration.' });
    const proof = result.rows[0];
    const safeFilename = String(proof.original_filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    res.writeHead(200, {
      'Content-Type': proof.content_type,
      'Content-Length': proof.file_data.length,
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    return res.end(proof.file_data);
  } catch (error) {
    console.error('Admin payment proof retrieval failed:', error.code || 'unknown');
    return sendJSON(res, 502, { ok: false, error: 'Could not retrieve the payment proof.' });
  }
}

function csvCell(value) {
  let text = value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
  // Prefix spreadsheet formula starters so downloaded CSV values remain data.
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

async function handleAdminExport(req, res, pool) {
  const admin = await requireAdmin(req, res, pool);
  if (!admin) return;
  try {
    const result = await pool.query(
      `SELECT r.id, r.created_at, r.name, r.phone, r.location, r.email, r.course,
              r.language, r.status, (p.registration_id IS NOT NULL) AS has_payment_proof
         FROM public.registrations r
         LEFT JOIN public.registration_payment_proofs p ON p.registration_id = r.id
        ORDER BY r.created_at DESC`
    );
    const headers = ['ID', 'Created at', 'Name', 'Phone', 'Location', 'Email', 'Course', 'Language', 'Status', 'Has payment proof'];
    const rows = result.rows.map((row) => [row.id, row.created_at, row.name, row.phone, row.location, row.email, row.course, row.language, row.status, row.has_payment_proof]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="purayidakrishi-registrations.csv"',
      'Cache-Control': 'private, no-store'
    });
    return res.end(`\uFEFF${csv}`);
  } catch (error) {
    console.error('Admin registrations export failed:', error.code || 'unknown');
    return sendJSON(res, 502, { ok: false, error: 'Could not export registrations.' });
  }
}

async function serveStatic(req, res, pathname) {
  let relativePath;
  if (pathname === '/' || pathname === '/index.html') relativePath = 'index.html';
  else if (pathname === '/admin' || pathname === '/admin/') relativePath = 'admin/index.html';
  else if (pathname === '/courses' || pathname === '/courses/' || pathname === '/courses.html') relativePath = 'courses.html';
  else {
    try { relativePath = decodeURIComponent(pathname).replace(/^\/+/, ''); }
    catch { return sendJSON(res, 400, { ok: false, error: 'Invalid path.' }); }
  }

  const filePath = path.resolve(PUBLIC, relativePath);
  const rootPath = path.resolve(PUBLIC);
  const mainFilePath = path.resolve(ROOT, relativePath);
  const allowedRoot = filePath.startsWith(rootPath + path.sep) || filePath === rootPath;
  const isRootHtml = relativePath === 'index.html' || relativePath === 'courses.html';
  const noStore = isRootHtml || relativePath === 'admin/index.html';
  const resolvedPath = isRootHtml ? mainFilePath : filePath;
  if (!allowedRoot) return sendJSON(res, 403, { ok: false, error: 'Forbidden.' });

  try {
    const stat = await fs.stat(resolvedPath);
    if (!stat.isFile()) return sendJSON(res, 404, { ok: false, error: 'Not found.' });
    const extension = path.extname(resolvedPath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': noStore ? 'no-store' : 'public, max-age=604800, stale-while-revalidate=86400'
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(resolvedPath).pipe(res);
  } catch {
    sendJSON(res, 404, { ok: false, error: 'Not found.' });
  }
}

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const origin = req.headers.origin;
  if (origin) {
    try {
      const parsedOrigin = new URL(origin);
      const host = req.headers.host;
      if (parsedOrigin.host !== host) return sendJSON(res, 403, { ok: false, error: 'Cross-origin request blocked.' });
    } catch {
      return sendJSON(res, 403, { ok: false, error: 'Invalid origin.' });
    }
  }

  let pathname;
  try { pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname; }
  catch { return sendJSON(res, 400, { ok: false, error: 'Invalid URL.' }); }

  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, HEAD, POST');
    return sendJSON(res, 405, { ok: false, error: 'Method not allowed.' });
  }
  if (pathname === '/api/admin/session') {
    if (req.method !== 'GET') return sendJSON(res, 405, { ok: false, error: 'Method not allowed.' });
    return handleAdminSession(req, res);
  }
  if (pathname === '/api/admin/login') {
    if (req.method !== 'POST') return sendJSON(res, 405, { ok: false, error: 'Method not allowed.' });
    return handleAdminLogin(req, res);
  }
  if (pathname === '/api/admin/logout') {
    if (req.method !== 'POST') return sendJSON(res, 405, { ok: false, error: 'Method not allowed.' });
    return handleAdminLogout(req, res);
  }
  if (pathname.startsWith('/api/admin/')) {
    let pool;
    try { pool = await getPostgresPool(); }
    catch (error) { console.error('Could not initialize PostgreSQL:', error.code || 'unknown'); }
    if (!pool) return sendJSON(res, 503, { ok: false, error: 'PostgreSQL is not configured.' });
    if (pathname === '/api/admin/dashboard' && req.method === 'GET') return handleAdminDashboard(req, res, pool);
    if (pathname === '/api/admin/registrations' && req.method === 'GET') return handleAdminRegistrations(req, res, pool, new URL(req.url, `http://${req.headers.host || 'localhost'}`));
    if (pathname === '/api/admin/contacts' && req.method === 'GET') return handleAdminContacts(req, res, pool, new URL(req.url, `http://${req.headers.host || 'localhost'}`));
    if (pathname === '/api/admin/exports/registrations.csv' && req.method === 'GET') return handleAdminExport(req, res, pool);
    const registrationStatusMatch = pathname.match(/^\/api\/admin\/registrations\/([0-9a-f-]{36})\/status$/i);
    if (registrationStatusMatch && req.method === 'POST') return handleAdminStatusUpdate(req, res, pool, 'registrations', registrationStatusMatch[1], REGISTRATION_STATUSES);
    const registrationProofMatch = pathname.match(/^\/api\/admin\/registrations\/([0-9a-f-]{36})\/proof$/i);
    if (registrationProofMatch && req.method === 'GET') return handleAdminPaymentProof(req, res, pool, registrationProofMatch[1]);
    const contactStatusMatch = pathname.match(/^\/api\/admin\/contacts\/([0-9a-f-]{36})\/status$/i);
    if (contactStatusMatch && req.method === 'POST') return handleAdminStatusUpdate(req, res, pool, 'contacts', contactStatusMatch[1], CONTACT_STATUSES);
    return sendJSON(res, 404, { ok: false, error: 'Admin API route not found.' });
  }
  if (pathname === '/api/contact') {
    if (req.method !== 'POST') return sendJSON(res, 405, { ok: false, error: 'Method not allowed.' });
    return handleContact(req, res);
  }
  if (pathname === '/api/registrations') {
    if (req.method !== 'POST') return sendJSON(res, 405, { ok: false, error: 'Method not allowed.' });
    return handleRegistration(req, res);
  }
  return serveStatic(req, res, pathname);
});

server.requestTimeout = 30000;
server.headersTimeout = 35000;
server.keepAliveTimeout = 5000;
server.listen(PORT, () => {
  console.log(`Purayidakrishi site ready at http://localhost:${PORT}`);
  if (!process.env.DATABASE_URL) console.log('Forms are in safe preview mode: configure DATABASE_URL to enable PostgreSQL submissions.');
});

// Drop expired rate-limit entries periodically without keeping unbounded IP data.
setInterval(() => {
  const now = Date.now();
  for (const [address, entry] of rateBuckets.entries()) {
    if (now - entry.startedAt > RATE_WINDOW_MS) rateBuckets.delete(address);
  }
}, RATE_WINDOW_MS).unref();
