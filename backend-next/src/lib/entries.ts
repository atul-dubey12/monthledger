import Decimal from 'decimal.js';
import { type Database, type TransactionDatabase, apiRow } from './db';
import { find } from './resources';
import { ApiError, bad, object, text, integer, choice, kinds, payments, allows, money, date, today, yearsFromToday, flag } from './validation';
type Body = Record<string, unknown>;
interface EntryData {
  date: string; kind: string; amount: string; categoryId: number;
  paymentMode: string | null; note: string | null; goalId: number | null; recurringId: number | null;
}
type References = Record<'categories' | 'goals' | 'recurring', Map<string, Body>>;
export async function validateEntry(db: Database, body: Body, existing?: Body, allowHidden = false, references?: References): Promise<EntryData> {
  const lookup = async (table: keyof References, id: number, message: string) => {
    if (!references) return find(db, table, id, message);
    const row = references[table].get(String(id));
    if (!row) bad(message);
    return row;
  };
  const kind = choice(body.kind, kinds);
  if (!kind) bad('Choose income, expense or saving.');
  const amount = money(body.amount), entryDate = date(body.date);
  if (!entryDate) bad('Pick a date.');
  if (entryDate < '2000-01-01') bad('That date is too far in the past.');
  if (entryDate > yearsFromToday(1)) bad('That date is too far in the future.');
  const note = text(body.note) || null;
  if (note && note.length > 180) bad('Notes can be up to 180 characters.');
  const categoryId = integer(body.categoryId);
  if (categoryId == null) bad('Pick a category.');
  const category = await lookup('categories', categoryId, 'That category no longer exists.');
  if (category.archived && Number(existing?.category_id) !== categoryId && !allowHidden) bad('That category is archived. Pick another one.');
  if (!allows(kind, category.bucket)) bad(`${category.name} can't be used for this kind of entry.`);
  const goalId = integer(body.goalId);
  if (goalId != null) {
    if (kind !== 'SAVING' && kind !== 'SAVING_WITHDRAWAL') bad('Only savings can count towards a goal.');
    const goal = await lookup('goals', goalId, 'That goal no longer exists.');
    if (goal.archived && Number(existing?.goal_id) !== goalId && !allowHidden) bad('That goal is hidden. Pick another one.');
  }
  const recurringId = integer(body.recurringId);
  if (recurringId != null) {
    const item = await lookup('recurring', recurringId, 'That monthly item no longer exists.');
    if (item.kind !== kind) bad("This entry doesn't match the monthly item it's paying.");
  }
  return { date: entryDate, kind, amount, categoryId, goalId, recurringId, paymentMode: choice(body.paymentMode, payments), note };
}
async function saveEntry(db: Database, e: EntryData, id?: number) {
  const values = [e.date, e.kind, e.amount, e.categoryId, e.paymentMode, e.note, e.goalId, e.recurringId];
  const result = id === undefined
    ? await db.query('INSERT INTO entries(entry_date,kind,amount,category_id,payment_mode,note,goal_id,recurring_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', values)
    : await db.query('UPDATE entries SET entry_date=$1,kind=$2,amount=$3,category_id=$4,payment_mode=$5,note=$6,goal_id=$7,recurring_id=$8 WHERE id=$9 RETURNING *', [...values, id]);
  return apiRow(result.rows[0]);
}
export async function writeEntry(db: Database, body: Body, id?: number) {
  const existing = id === undefined ? undefined : await find(db, 'entries', id, 'This entry no longer exists.', 404);
  return saveEntry(db, await validateEntry(db, body, existing), id);
}
export async function deleteEntry(db: Database, id: number) {
  if (!(await db.query('DELETE FROM entries WHERE id=$1', [id])).rowCount) throw new ApiError(404, 'This entry no longer exists.');
}
function range(params: URLSearchParams, exporting: boolean): [string, string] {
  const from = date(params.get('from')), to = date(params.get('to'));
  if (!exporting && (!from || !to)) bad("Provide both 'from' and 'to' dates.");
  if (from && to && to < from) bad("'to' must be on or after 'from'.");
  if (!exporting && (Date.parse(to!) - Date.parse(from!)) / 86400000 > 400) bad('Ask for at most 400 days at a time.');
  return [from ?? '1900-01-01', to ?? '9999-12-31'];
}
export async function listEntries(db: Database, params: URLSearchParams) {
  return (await db.query('SELECT * FROM entries WHERE entry_date BETWEEN $1 AND $2 ORDER BY entry_date DESC, id DESC', range(params, false))).rows.map(apiRow);
}
function csvText(value: unknown): string {
  if (value == null || value === '') return '';
  const original = String(value), safe = /^[=+\-@]/.test(original) ? `'${original}` : original;
  return `"${safe.replaceAll('"', '""')}"`;
}
export async function exportEntries(db: Database, params: URLSearchParams) {
  const dates = range(params, true);
  const rows = (await db.query(`SELECT e.*, c.name AS category_name, c.bucket, g.name AS goal_name, r.name AS recurring_name
    FROM entries e LEFT JOIN categories c ON c.id=e.category_id LEFT JOIN goals g ON g.id=e.goal_id
    LEFT JOIN recurring r ON r.id=e.recurring_id WHERE e.entry_date BETWEEN $1 AND $2 ORDER BY e.entry_date, e.id`, dates)).rows;
  let csv = '\ufeffDate,Kind,Category,Bucket,Amount,Payment,Note,Goal,Monthly item\r\n';
  for (const row of rows) csv += [row.entry_date, row.kind, csvText(row.category_name), row.bucket ?? '', new Decimal(String(row.amount)).toFixed(), row.payment_mode ?? '', csvText(row.note), csvText(row.goal_name), csvText(row.recurring_name)].join(',') + '\r\n';
  const name = !params.has('from') && !params.has('to') ? `monthledger-all-${today()}.csv` : `monthledger-${dates[0]}-to-${dates[1]}.csv`;
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` } });
}
function duplicateKey(e: EntryData): string {
  return JSON.stringify([e.date, e.kind, e.categoryId, new Decimal(e.amount).toFixed(), e.paymentMode ?? '', e.note ?? '']);
}
export async function importEntries(database: TransactionDatabase, body: Body) {
  if (!Array.isArray(body.entries)) bad('Nothing to import.');
  if (body.entries.length > 5000) bad('Import at most 5,000 rows at a time.');
  const input = body.entries, dryRun = flag(body.dryRun) ?? false;
  return database.transaction(async db => {
    // Serialize imports with other entry writers (including the Java API), leaving reads available.
    await db.query('LOCK TABLE entries IN SHARE ROW EXCLUSIVE MODE');
    // Fetch reference tables once, rather than making thousands of remote validation queries.
    const references: References = { categories: new Map(), goals: new Map(), recurring: new Map() };
    for (const table of ['categories', 'goals'] as const) {
      for (const row of (await db.query(`SELECT * FROM ${table}`)).rows) references[table].set(String(row.id), row);
    }
    const saved = new Map<string, number>();
    for (const row of (await db.query('SELECT * FROM entries')).rows) {
      const key = duplicateKey(apiRow(row) as unknown as EntryData);
      saved.set(key, (saved.get(key) ?? 0) + 1);
    }
    const fresh: EntryData[] = [], errors: { row: number; message: string }[] = [];
    let duplicates = 0;
    for (let i = 0; i < input.length; i++) {
      let line = i + 1;
      try {
        const row = object(input[i]);
        line = integer(row.row) ?? line;
        const entry = await validateEntry(db, { ...row, recurringId: null }, undefined, true, references);
        const key = duplicateKey(entry), left = saved.get(key) ?? 0;
        if (left > 0) { saved.set(key, left - 1); duplicates++; }
        else fresh.push(entry);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 400) throw error;
        errors.push({ row: line, message: error.message });
      }
    }
    if (!dryRun) {
      // Existing behavior: skip invalid rows and atomically save all valid, new rows.
      fresh.sort((a, b) => a.date.localeCompare(b.date));
      // Bounded batches reduce network latency while preserving stable date/file ordering.
      for (let start = 0; start < fresh.length; start += 250) {
        const batch = fresh.slice(start, start + 250);
        const values = batch.flatMap(e => [e.date, e.kind, e.amount, e.categoryId, e.paymentMode, e.note, e.goalId, e.recurringId]);
        const placeholders = batch.map((_, i) => `(${Array.from({ length: 8 }, (_, j) => `$${i * 8 + j + 1}`).join(',')})`).join(',');
        await db.query(`INSERT INTO entries(entry_date,kind,amount,category_id,payment_mode,note,goal_id,recurring_id) VALUES ${placeholders}`, values);
      }
    }
    return { imported: fresh.length, duplicates, errors };
  });
}
