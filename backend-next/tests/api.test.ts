import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createApi } from '../src/lib/api';
import { withTransactions, dateTypes, type TransactionDatabase } from '../src/lib/db';
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('Set TEST_DATABASE_URL to a disposable PostgreSQL database. Tests use isolated schemas.');
const key = 'test-key-test-key-test-key-test-key';
let pool: Pool, admin: Pool, schema: string, db: TransactionDatabase;
let api: ReturnType<typeof createApi>;
beforeEach(async () => {
  schema = `test_${randomUUID().replaceAll('-', '')}`;
  admin = new Pool({ connectionString, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool = new Pool({ connectionString, max: 3, options: `-c search_path=${schema}`, types: dateTypes });
  for (const name of (await readdir('migrations')).sort()) await pool.query(await readFile(`migrations/${name}`, 'utf8'));
  db = withTransactions(pool);
  api = createApi(db, { apiKey: key, requireKey: true, allowedOrigins: ['https://app.example'] });
});
afterEach(async () => {
  await pool?.end();
  if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
});
async function request(path: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}) {
  return api(new Request(`http://localhost/api/${path}`, { method, headers: { 'X-Api-Key': key, 'Content-Type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) }));
}
async function json(path: string, method = 'GET', body?: unknown, status = 200) {
  const response = await request(path, method, body), value = await response.json();
  assert.equal(response.status, status, JSON.stringify(value));
  return value;
}
const entry = (overrides = {}) => ({ date: '2020-11-10', kind: 'EXPENSE', amount: 40, categoryId: 11, paymentMode: 'UPI', note: 'Tea', ...overrides });
const goal = (overrides = {}) => ({ name: 'Emergency fund', targetAmount: 100000, startingAmount: 12000, ...overrides });
const monthly = (overrides = {}) => ({ name: 'Gym fee', kind: 'EXPENSE', amount: 1500, categoryId: 21, dayOfMonth: 10, paymentMode: 'UPI', ...overrides });
const listPath = 'entries?from=2020-11-01&to=2020-11-30';

test('health is public; protected endpoints require the correct key and are never cached', async () => {
  assert.equal((await request('health', 'GET', undefined, { 'X-Api-Key': '' })).status, 200);
  for (const sent of ['', 'wrong', 'x'.repeat(500)]) {
    const response = await request('categories', 'GET', undefined, { 'X-Api-Key': sent, Origin: 'https://app.example' });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://app.example');
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  }
});
test('production fails closed without a configured key', async () => {
  for (const apiKey of [undefined, 'short']) {
    const handler = createApi(db, { requireKey: true, apiKey });
    assert.equal((await handler(new Request('http://localhost/api/settings'))).status, 503);
    assert.equal((await handler(new Request('http://localhost/api/health'))).status, 200);
  }
});
test('CORS preflight needs no key; untrusted origins are rejected', async () => {
  const good = await request('entries', 'OPTIONS', undefined, { Origin: 'https://app.example', 'X-Api-Key': '' });
  assert.equal(good.status, 204);
  assert.match(good.headers.get('Access-Control-Allow-Headers')!, /X-Api-Key/);
  assert.equal(good.headers.get('Access-Control-Expose-Headers'), 'Content-Disposition');
  assert.equal((await request('settings', 'GET', undefined, { Origin: 'https://evil.example' })).status, 403);
});
test('default seed and settings retain the existing contract', async () => {
  const rows = await json('categories');
  assert.equal(rows.length, 22); assert.equal(rows[0].name, 'Salary');
  assert.equal(rows.filter((r: { bucket: string }) => r.bucket === 'NEED').length, 8);
  assert.equal(rows.find((r: { name: string }) => r.name === 'Home contribution').monthlyBudget, 15000);
  assert.deepEqual(await json('settings'), { id: 1, name: '', needsPercent: 50, wantsPercent: 30, savingsPercent: 20, monthStartDay: 5 });
});
test('settings validate split and start day and trim names', async () => {
  const s = { name: ' Atul ', needsPercent: 50, wantsPercent: 30, savingsPercent: 20, monthStartDay: 5 };
  for (const change of [{ savingsPercent: 30 }, { monthStartDay: 31 }, { needsPercent: 49.5 }, { name: 'a'.repeat(31) }]) await json('settings', 'PUT', { ...s, ...change }, 400);
  assert.equal((await json('settings', 'PUT', s)).name, 'Atul');
});
test('categories create, reject duplicate names and archive', async () => {
  const c = { name: ' Gym ', bucket: 'WANT', monthlyBudget: 1500 };
  const saved = await json('categories', 'POST', c, 201);
  assert.equal(saved.icon, '•');
  await json('categories', 'POST', { ...c, name: 'gym' }, 400);
  assert.equal((await json(`categories/${saved.id}`, 'PUT', { ...c, archived: true })).archived, true);
  await json('categories', 'POST', { ...c, monthlyBudget: 1.005 }, 400);
});
test('entries preserve date-only values, numeric amounts, order and delete behavior', async () => {
  await json('entries', 'POST', entry({ date: '2020-11-05', kind: 'INCOME', amount: 30000, categoryId: 1, note: '  ' }), 201);
  await json('entries', 'POST', entry({ amount: 850.50, categoryId: 5 }), 201);
  const saving = await json('entries', 'POST', entry({ kind: 'SAVING', amount: 6000, categoryId: 17 }), 201);
  await json('entries', 'POST', entry({ date: '2020-12-05' }), 201);
  const rows = await json(listPath);
  assert.equal(rows.length, 3); assert.equal(rows[0].kind, 'SAVING');
  assert.equal(rows[1].amount, 850.5); assert.equal(rows[1].date, '2020-11-10'); assert.equal(rows[2].note, null);
  assert.equal((await request(`entries/${saving.id}`, 'DELETE')).status, 204);
  await json(`entries/${saving.id}`, 'DELETE', undefined, 404);
});
test('entry validation rejects wrong buckets, references, amounts, dates and enums', async () => {
  for (const change of [{ categoryId: 1 }, { categoryId: 999 }, { amount: 0 }, { amount: -2 }, { amount: 10.555 }, { amount: 100000001 }, { date: '2020-02-30' }, { date: '1999-01-01' }, { date: '9999-01-01' }, { paymentMode: 'BITCOIN' }, { kind: 'INVALID' }, { note: 'a'.repeat(181) }]) await json('entries', 'POST', entry(change), 400);
  assert.equal((await json('entries', 'POST', entry({ amount: 100000000 }), 201)).amount, 100000000);
});
test('existing entries may retain hidden categories; used categories cannot change bucket', async () => {
  const saved = await json('entries', 'POST', entry(), 201);
  const category = { name: 'Food delivery & eating out', bucket: 'WANT', archived: true };
  await json('categories/11', 'PUT', category);
  await json(`entries/${saved.id}`, 'PUT', entry({ amount: 45 }));
  await json('entries', 'POST', entry(), 400);
  await json('entries/9999', 'PUT', entry(), 404);
  await json('categories/11', 'PUT', { ...category, bucket: 'NEED' }, 400);
});
test('entry range requires real dates, correct order and at most 400 days', async () => {
  for (const query of ['', '?from=2020-01-01', '?from=bad&to=2020-11-01', '?from=2020-11-10&to=2020-11-01', '?from=2018-01-01&to=2020-11-01']) await json(`entries${query}`, 'GET', undefined, 400);
});
test('goal totals use exact decimal arithmetic and subtract withdrawals', async () => {
  const saved = await json('goals', 'POST', goal({ startingAmount: 0.1 }), 201);
  await json('entries', 'POST', entry({ kind: 'SAVING', amount: 0.2, categoryId: 17, goalId: saved.id }), 201);
  assert.equal((await json('goals'))[0].saved, 0.3);
  await json('entries', 'POST', entry({ kind: 'SAVING_WITHDRAWAL', amount: 0.1, categoryId: 17, goalId: saved.id }), 201);
  assert.equal((await json('goals'))[0].saved, 0.2);
  assert.equal((await json(`goals/${saved.id}`, 'PUT', goal({ startingAmount: 1 }))).saved, 1.1);
});
test('goals validate amounts and protect hidden goal links', async () => {
  for (const change of [{ name: '' }, { targetAmount: 0 }, { startingAmount: -5 }, { targetAmount: 1.001 }]) await json('goals', 'POST', goal(change), 400);
  const g = await json('goals', 'POST', { name: 'Bike', targetAmount: 80000 }, 201);
  assert.equal(g.icon, '🎯'); assert.equal(g.saved, 0);
  await json('entries', 'POST', entry({ goalId: g.id }), 400);
  const saving = entry({ kind: 'SAVING', categoryId: 17, goalId: g.id });
  const old = await json('entries', 'POST', saving, 201);
  await json(`goals/${g.id}`, 'PUT', { name: 'Bike', targetAmount: 80000, archived: true });
  await json('entries', 'POST', saving, 400);
  await json(`entries/${old.id}`, 'PUT', { ...saving, amount: 50 });
});
test('recurring items sort by day, stop without deletion, and validate matching payments', async () => {
  const gym = await json('recurring', 'POST', monthly(), 201);
  const home = await json('recurring', 'POST', monthly({ name: 'Home money', categoryId: 20, dayOfMonth: 5 }), 201);
  assert.deepEqual((await json('recurring')).map((r: { id: number }) => r.id), [home.id, gym.id]);
  await json(`recurring/${home.id}`, 'PUT', monthly({ active: false }));
  assert.equal((await json('recurring')).length, 1);
  assert.equal((await json('entries', 'POST', entry({ categoryId: 21, recurringId: gym.id }), 201)).recurringId, gym.id);
  await json('entries', 'POST', entry({ kind: 'SAVING', categoryId: 17, recurringId: gym.id }), 400);
});
test('recurring validates kind, category and day; non-saving goal links are ignored', async () => {
  for (const change of [{ categoryId: 1 }, { dayOfMonth: 0 }, { dayOfMonth: 32 }, { kind: 'SAVING_WITHDRAWAL' }, { name: ' ' }, { amount: 0 }]) await json('recurring', 'POST', monthly(change), 400);
  assert.equal((await json('recurring', 'POST', monthly({ goalId: 9999 }), 201)).goalId, null);
});
test('CSV export preserves BOM, names, quoting, formula guard, decimal formatting and range', async () => {
  await json('entries', 'POST', entry({ date: '2020-11-08', amount: 2350.50, categoryId: 5, note: '=SUM(1,2) "weekly"' }), 201);
  await json('entries', 'POST', entry({ date: '2020-11-05', kind: 'INCOME', amount: 31000, categoryId: 1, paymentMode: 'BANK', note: null }), 201);
  const response = await request('entries/export'), bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [239, 187, 191]);
  assert.equal(new TextDecoder().decode(bytes), 'Date,Kind,Category,Bucket,Amount,Payment,Note,Goal,Monthly item\r\n2020-11-05,INCOME,"Salary",INCOME,31000,BANK,,,\r\n2020-11-08,EXPENSE,"Groceries",NEED,2350.5,UPI,"\'=SUM(1,2) ""weekly""",,\r\n');
  assert.match(response.headers.get('Content-Disposition')!, /^attachment; filename="monthledger-all-/);
  assert.equal((await (await request('entries/export?from=2020-11-06&to=2020-11-30')).text()).trim().split('\r\n').length, 2);
});
test('import previews, preserves genuine repeats, skips saved rows and reports invalid ones', async () => {
  await json('entries', 'POST', entry(), 201);
  const entries = [entry({ row: 2, amount: '40.00' }), entry({ row: 3 }), entry({ row: 4, amount: 0 }), entry({ row: 5, categoryId: 1 }), entry({ row: 6, date: '2020-11-05', kind: 'INCOME', categoryId: 1, amount: 31000 })];
  const preview = await json('entries/import', 'POST', { dryRun: true, entries });
  assert.equal(preview.imported, 2); assert.equal(preview.duplicates, 1);
  assert.deepEqual(preview.errors.map((e: { row: number }) => e.row), [4, 5]);
  assert.equal((await json(listPath)).length, 1);
  assert.deepEqual(await json('entries/import', 'POST', { dryRun: false, entries }), preview);
  assert.equal((await json(listPath)).length, 3);
  const repeated = await json('entries/import', 'POST', { entries });
  assert.equal(repeated.imported, 0); assert.equal(repeated.duplicates, 3);
});
test('import permits hidden categories and goals and ignores recurring links like Java', async () => {
  const g = await json('goals', 'POST', goal(), 201);
  await json(`goals/${g.id}`, 'PUT', goal({ archived: true }));
  await json('categories/17', 'PUT', { name: 'Emergency fund', bucket: 'SAVING', archived: true });
  const result = await json('entries/import', 'POST', { entries: [entry({ kind: 'SAVING', categoryId: 17, goalId: g.id, recurringId: 9999 })] });
  assert.deepEqual(result, { imported: 1, duplicates: 0, errors: [] });
  assert.equal((await json(listPath))[0].recurringId, null);
});
test('import rejects oversized batches and reports malformed rows', async () => {
  await json('entries/import', 'POST', { entries: Array(5001).fill(entry()) }, 400);
  await json('entries/import', 'POST', {}, 400);
  const result = await json('entries/import', 'POST', { entries: [null, entry()] });
  assert.equal(result.imported, 1); assert.equal(result.errors[0].row, 1);
});
test('concurrent imports do not duplicate the same file', async () => {
  const results = await Promise.all([json('entries/import', 'POST', { entries: [entry()] }), json('entries/import', 'POST', { entries: [entry()] })]);
  assert.equal(results.reduce((sum, r) => sum + r.imported, 0), 1);
  assert.equal((await json(listPath)).length, 1);
});
test('database failure rolls back all fresh import rows', async () => {
  let inserts = 0;
  const broken: TransactionDatabase = { ...db, transaction: work => db.transaction(tx => work({ query: async (sql, values) => {
    if (sql.startsWith('INSERT INTO entries') && ++inserts === 2) throw new Error('Simulated insert failure');
    return tx.query(sql, values);
  } })) };
  const response = await createApi(broken)(new Request('http://localhost/api/entries/import', { method: 'POST', body: JSON.stringify({ entries: Array.from({ length: 251 }, (_, i) => entry({ amount: i + 1 })) }) }));
  assert.equal(response.status, 500); assert.equal((await json(listPath)).length, 0);
});
test('malformed JSON and unsupported routes return safe JSON errors', async () => {
  assert.equal((await api(new Request('http://localhost/api/entries', { method: 'POST', headers: { 'X-Api-Key': key }, body: '{' }))).status, 400);
  await json('missing', 'GET', undefined, 404);
  await json('categories/1', 'DELETE', undefined, 405);
});

test('large imports keep row order across batches and remain idempotent', async () => {
  const entries = Array.from({ length: 501 }, (_, i) => entry({ amount: i + 1 }));
  const first = await json('entries/import', 'POST', { entries });
  assert.equal(first.imported, 501);
  const rows = await json(listPath);
  assert.equal(rows[0].amount, 501);
  assert.equal(rows[500].amount, 1);
  const second = await json('entries/import', 'POST', { entries });
  assert.equal(second.imported, 0);
  assert.equal(second.duplicates, 501);
});
