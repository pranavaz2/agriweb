import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { hashPassword } from '../lib/admin-auth.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function loadEnv() {
  try {
    const text = await fs.readFile(path.join(ROOT, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index < 1) continue;
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

await loadEnv();
const username = String(process.env.ADMIN_USERNAME || '').trim().toLowerCase();
const password = String(process.env.ADMIN_PASSWORD || '');
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. Configure it in .env first.');
  process.exit(1);
}
if (!/^[a-z0-9._-]{3,50}$/.test(username)) {
  console.error('Set ADMIN_USERNAME to 3–50 characters using letters, numbers, dot, underscore or hyphen.');
  process.exit(1);
}
if (password.length < 14 || password.length > 200) {
  console.error('Set ADMIN_PASSWORD to a strong password of at least 14 characters.');
  process.exit(1);
}

const { Pool } = await import('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true'
    ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : undefined
});
const client = await pool.connect();
try {
  const passwordHash = await hashPassword(password);
  await client.query('BEGIN');
  const result = await client.query(
    `INSERT INTO public.admin_users (username, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()
     RETURNING id`,
    [username, passwordHash]
  );
  // A password reset revokes every existing session for this admin.
  await client.query('DELETE FROM public.admin_sessions WHERE admin_id = $1', [result.rows[0].id]);
  await client.query('COMMIT');
  console.log(`Admin account '${username}' created/updated successfully.`);
  console.log('You can now sign in at /admin. Keep the password private.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Could not create admin account:', error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
