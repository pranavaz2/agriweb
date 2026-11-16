# Purayidakrishi website rebuild

A responsive bilingual rebuild inspired by the supplied Purayidakrishi mobile screenshots. The homepage is one long scrolling page with section/jump-link navigation. The course programme is a separate `/courses` route. English and Malayalam are toggled in place from the header; the choice is saved in local storage and restored on the next page.

## Included

- Homepage sections: Home, Discover More, Courses, Agroecology Categories, Blog, Book Store, My Story, Gallery, Services, FAQ and Contact.
- Responsive desktop navigation and mobile drawer.
- In-place English / Malayalam language toggle; Malayalam is the initial language.
- Course overview and registration enquiry page.
- Accessible form labels, native validation, status announcements, keyboard support and reduced-motion handling.
- Node.js server with same-origin JSON/multipart endpoints, basic rate limiting, security headers, input validation and safe file-size/type checks.
- Native PostgreSQL integration for contact messages and course registrations.
- Optional payment-proof files stored privately as PostgreSQL `BYTEA` data in the same transaction as the related registration.
- SEO metadata, canonical URLs, Open Graph metadata, `robots.txt`, `sitemap.xml` and favicon.
- Original SVG illustrations used as stand-in creative assets rather than unlicensed third-party photographs.

## Requirements

- Node.js 20.6 or later (tested target: Node 22+).
- PostgreSQL 13 or later.

## Run locally

```bash
npm install
cp .env.example .env
# Add your PostgreSQL connection details to .env (see below).
npm run dev
```

Open `http://localhost:3000`.

The website can still run without a database connection for preview. In that state, form submissions return HTTP 503 and do not show a false success message.

## Configure PostgreSQL

1. Create a PostgreSQL database and a database user for this website.
2. Run `postgresql-schema.sql` against that database. For example:

   ```bash
   psql "$DATABASE_URL" -f postgresql-schema.sql
   ```

3. Add the connection details to the server's `.env` file:

   ```dotenv
   DATABASE_URL=postgresql://USERNAME:PASSWORD@HOST:5432/DATABASE_NAME
   DATABASE_SSL=false
   DATABASE_SSL_REJECT_UNAUTHORIZED=true
   PORT=3000
   ```

4. Install the Node.js dependencies with `npm install` and restart the server.
5. Submit a test contact message and course registration. Verify the rows in `contacts` and `registrations`. If a payment proof is attached, verify its metadata and `file_data` in `registration_payment_proofs`.

Set `DATABASE_SSL=true` when your PostgreSQL hosting provider requires TLS. Certificate validation remains enabled by default. Only set `DATABASE_SSL_REJECT_UNAUTHORIZED=false` when the provider uses a private/self-signed certificate and you understand the security trade-off.

**Security:** Keep `DATABASE_URL` on the server only. Never put it in HTML, CSS, browser JavaScript, a public repository, or a `NEXT_PUBLIC_*` variable. Use a database role with only the required permissions, serve the site over HTTPS, configure database backups and retention, and restrict access to personal information. Payment-proof files are stored as private database binary data and are not published through public URLs.

## Private admin dashboard

A protected administration area is available at `http://localhost:3000/admin`. It does not alter the public homepage or course page. The dashboard includes registration and contact-enquiry lists, search and status filters, registration status updates, private payment-proof downloads, summary counts, and CSV export. Admin login uses scrypt password hashes and random, database-backed sessions stored as SHA-256 token hashes. Sessions expire after 8 hours; cookies are HttpOnly and SameSite=Strict (Secure is enabled in production). There is no public admin registration or default password.

### Install the admin tables

For an existing database created before the admin dashboard was added, apply the incremental schema once:

```powershell
psql -h localhost -p 5432 -U purayida_app -d purayidakrishi -f .\admin-schema.sql
```

New databases can use the updated `postgresql-schema.sql`, which also includes these admin tables.

### Create or reset the first admin account

In PowerShell, set a username and a strong password (at least 14 characters), then run the account setup command:

```powershell
$env:ADMIN_USERNAME = "admin"
$env:ADMIN_PASSWORD = "Replace-With-A-Long-Unique-Password"
npm run admin:create
Remove-Item Env:ADMIN_USERNAME
Remove-Item Env:ADMIN_PASSWORD
```

The command creates the account or resets the password for that username. The password is hashed before it is stored. The environment variables are removed from the current terminal session after setup. Do not use the example password.

Sign in at `http://localhost:3000/admin`. The admin account can view personal data and payment proof uploads, so use a unique strong password, enable HTTPS in production, limit database access, and sign out from shared computers. The dashboard routes are excluded from search indexing.

### Dashboard API

- `GET /api/admin/session` — check the current session.
- `POST /api/admin/login` and `POST /api/admin/logout` — sign in and sign out.
- `GET /api/admin/dashboard` — summary counts.
- `GET /api/admin/registrations` — searchable registration list.
- `POST /api/admin/registrations/:id/status` — update a registration status.
- `GET /api/admin/registrations/:id/proof` — authenticated private payment-proof download.
- `GET /api/admin/contacts` — searchable contact enquiries.
- `POST /api/admin/contacts/:id/status` — update an enquiry status.
- `GET /api/admin/exports/registrations.csv` — authenticated CSV export.

## Deployment

Deploy the project to a Node.js host that supports Node 20.6+ and environment variables (for example, a Node application host or a container platform). Set the command to `npm start`, configure `DATABASE_URL` and any required TLS options as encrypted environment variables, and serve the domain over HTTPS. Configure the hosting platform's health checks and logs. The server does not trust `X-Forwarded-For` by default; if deployed behind a reverse proxy, configure the hosting layer and revisit rate-limit client IP handling rather than trusting arbitrary client headers.

The canonical host and sitemap currently use `https://www.purayidakrishi.com/`; update those URLs if the production domain differs.

## Verified from the supplied reference screenshots

- One long homepage with in-page navigation links for Home, Blog, My Story, Services, Book Store, Courses, Gallery, FAQ and Contact.
- A separate course page.
- Language switch control for Malayalam and English.
- Course page indicates Zoom live class delivery, a registration form, optional email, payment-information area and payment-proof upload.
- Contact details visible in the screenshots: `purayidakrishi@gmail.com`, `+91 81388 45709` (booking), and `+91 89215 56890` (book orders).

## Items requiring owner confirmation before production

The original website could not be inspected beyond its JavaScript shell in the automated browser, so the screenshots are the available source of truth. Do not treat the following as verified production content:

- Exact article text, post URLs, dates and original images.
- Full service descriptions, founder biography/portrait and gallery media.
- The course's exact title, date, session count, time, fee, trainer name/credentials, syllabus and testimonials.
- The official course payment QR / UPI ID and payment instructions. The form currently explains that payment details must be confirmed with the organiser before paying; it does not invent a QR code or fee.
- Exact social-media profile URLs and postal address.

The section titles and starter copy in the rebuild are bilingual and editable, but service descriptions and article summaries are editorial placeholders based on the website's visible purpose. Replace them with owner-approved original copy and links. The SVG illustrations are new stand-in assets; replace them with approved original farm, trainer, course-poster and gallery assets when supplied.

## QA

- JavaScript syntax checks for the server and browser script.
- HTTP smoke tests for homepage, course route, CSS, JS, sitemap and favicon.
- API endpoints return safe HTTP 503 responses when no PostgreSQL URL is configured.
- The automated test suite includes admin static/auth checks by default and optional real-PostgreSQL integration checks (including login, session protection, status updates and CSV export) when `TEST_DATABASE_URL` is provided.
- Responsive layouts authored for desktop, tablet and mobile breakpoints.

Run the default checks with:

```bash
npm run check
npm test
```

To run the database-backed integration tests against a dedicated test database, configure `TEST_DATABASE_URL` (and `TEST_DATABASE_SSL=true` if required) before running `npm test`. The test setup applies the schema and clears the `contacts` and `registrations` test tables, so do not point it at a production database.

A full cross-browser visual QA and live production database test still require a browser-testing environment and the owner's PostgreSQL connection details.
