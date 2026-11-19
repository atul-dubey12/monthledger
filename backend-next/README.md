# MonthLedger Next.js API

TypeScript replacement for Spring Boot, deployable on Vercel. It preserves the Angular API and existing Neon PostgreSQL V1–V5 schema. The Java backend stays available during migration.

## Local development

Use Node.js 22 (`nvm use`), then run from this directory:

```bash
npm ci
cp .env.example .env.local
# Set DATABASE_URL in .env.local to a development PostgreSQL database.
npm run db:check
npm run dev
```

Next.js listens on port 8081. Stop Java first, then run `npm start` in `../frontend`; the existing Angular proxy works unchanged. An empty API_KEY is allowed only in local development.

For a **new empty development database only**, run `npm run db:init`. It refuses any nonempty schema and executes the copied SQL migrations atomically. It does not install Flyway metadata; databases initialized this way are for Next.js. Future schema changes need explicit versioned migrations, not another initialization.

For existing Neon data, use only `npm run db:check`. This read-only check verifies expected columns and the settings row. No data transfer, schema change or reseeding is needed when Java migrations V1–V5 are already applied. Builds and requests never run migrations.

## Vercel: two projects, the same GitHub repository

Use **atul-dubey12/monthledger** for both projects.

### Backend

Select root **backend-next**, framework **Next.js**, Node.js **22.x**, build command `npm run build`, and the framework's default output directory.

Set these backend environment variables:

- `DATABASE_URL`: Neon's **pooled PostgreSQL URL**, including SSL options. This is not the old JDBC `DB_URL`. Username/password are included in the URL; separate `DB_USER`/`DB_PASSWORD` are no longer used.
- `API_KEY`: at least 32 characters. Reuse the existing server key if desired. Never commit it or put it in frontend variables.
- `ALLOWED_ORIGINS`: exact frontend origins, comma-separated, without trailing slashes. Include the new frontend's Vercel URL; optionally include `http://localhost:4201` and `https://atul-dubey12.github.io` during transition.
- `APP_TIME_ZONE`: defaults to `UTC`, the normal Render server timezone. Set explicitly if the old server used another zone. Stored dates remain calendar dates without timezone conversion.

Select a function region close to Neon. Give Preview deployments a separate development database and key. Allow exact preview frontend origins or a stable preview domain, not all Vercel domains. Vercel deployment-protection login can block cross-project requests: the production API must be browser-accessible, with the application's API key protecting data routes.

`GET /api/health` returns `{"status":"ok"}` without authentication or a database connection. Also check `/api/settings` with `X-Api-Key` to verify database access. Protected routes fail closed if the production key is missing/too short.

### Frontend

Import the **same repository** again with root **frontend**, framework **Angular**, Node.js **22.x**.

Set `API_ORIGIN` to your backend HTTPS origin, for example `https://your-api-project.vercel.app` (no `/api` suffix). This is a public URL, not a secret. `frontend/vercel.json` supplies the build command, output directory and SPA fallback.

The build validates this URL and generates a temporary Angular configuration. Browser requests go directly to the backend, so add this frontend origin to backend `ALLOWED_ORIGINS` and redeploy after changing that variable. No placeholder backend URL is committed.

`npm run build:pages` still targets Render, and local development is unchanged. The new frontend origin has separate localStorage, so enter your server key once in its Settings.

### Cutover and rollback

Take a backup. First test on a separate Neon branch/development database. Check entries, edits/deletes, settings, categories, goals, monthly items and CSV preview/import/export. Compare savings totals and dates against Java. Then configure the production backend with the existing Neon database and verify it before retiring Render. The old Pages/Render deployment can still use the unchanged schema for rollback.

Vercel and Neon can still have cold starts; permanently warm compute is not guaranteed. Large exports remain subject to platform response-size limits. Imports accept up to 5,000 rows and use bounded batches inside one transaction; split larger backups if necessary.

## API compatibility

- `GET /api/health` (public)
- `GET`, `PUT /api/settings`
- `GET`, `POST /api/categories`; `PUT /api/categories/:id`
- `GET`, `POST /api/goals`; `PUT /api/goals/:id`
- `GET`, `POST /api/recurring`; `PUT /api/recurring/:id`
- `GET /api/entries?from=YYYY-MM-DD&to=YYYY-MM-DD`; `POST /api/entries`
- `PUT`, `DELETE /api/entries/:id`
- `GET /api/entries/export` (optional from/to)
- `POST /api/entries/import` (`entries` array, optional `dryRun`)

Errors use `{"message":"..."}`. Data requests require `X-Api-Key` in production and are never cached. JSON money fields remain numbers for Angular; validation uses decimal arithmetic and sums use PostgreSQL NUMERIC. Dates remain `YYYY-MM-DD` strings.

Import matches the Java implementation and tests: invalid rows are reported/skipped; all valid new rows save atomically or roll back on database failure. Repeats are preserved only beyond the count already saved. Preview writes nothing. Concurrent imports are serialized. Recurring bills remain manually recorded; no scheduler is introduced.

## Verification

```bash
npm run typecheck
npm run build
# Use a disposable local database, never production.
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/monthledger_test npm test
```

Integration tests create a unique schema per test, apply V1–V5 and remove only that schema afterwards. Coverage includes auth/CORS, validation, exact totals, dates, archived references, recurring payments, CSV, import preview/idempotency/concurrency/batching and rollback. Database credentials are not required to build.
