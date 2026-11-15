import { Category, EntryKind, Goal, PaymentMode } from './models';

/**
 * Reads MonthLedger backup CSVs (and files Excel has opened and re-saved). Pure functions, no Angular.
 * Must stay in step with EntryCsv.java: same header names, same ' formula guard.
 */
export interface ImportRow {
  /** Line in the file (the header is line 1), for messages. */
  row: number;
  date: string;
  kind: EntryKind;
  amount: number;
  categoryId: number;
  paymentMode: PaymentMode | null;
  note: string | null;
  goalId: number | null;
}
export interface CsvProblem { row: number; message: string; }

/** Splits CSV text into rows of fields: quotes, "" escapes, commas and line breaks inside quotes, CRLF or LF. */
export function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '', row: string[] = [], quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Undoes the export's guard: '=SUM(…) back to =SUM(…). */
function unguard(value: string): string {
  return value.length > 1 && value[0] === "'" && '=+-@'.includes(value[1]) ? value.slice(1) : value;
}

/** yyyy-mm-dd, or dd/mm/yyyy and dd-mm-yyyy as Excel in India writes them. Returns yyyy-mm-dd or null. */
export function parseDate(value: string): string | null {
  const v = value.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (match) { y = +match[1]; m = +match[2]; d = +match[3]; }
  else if ((match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v))) { d = +match[1]; m = +match[2]; y = +match[3]; }
  else return null;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const KINDS: Record<string, EntryKind> = {
  INCOME: 'INCOME', EXPENSE: 'EXPENSE', SAVING: 'SAVING', SAVINGS: 'SAVING',
  SAVING_WITHDRAWAL: 'SAVING_WITHDRAWAL', 'SAVING WITHDRAWAL': 'SAVING_WITHDRAWAL', WITHDRAWAL: 'SAVING_WITHDRAWAL',
};
const MODES: PaymentMode[] = ['UPI', 'CARD', 'CASH', 'BANK'];

/**
 * Turns the file into rows the API can check. Names are matched without caring about case, hidden
 * categories and goals included (old backups). A goal name that no longer exists just leaves the row
 * unlinked. Rows come back oldest first, keeping file order within a day.
 */
export function readBackup(text: string, categories: Category[], goals: Goal[]): { rows: ImportRow[]; problems: CsvProblem[] } {
  const lines = splitCsv(text);
  const problems: CsvProblem[] = [];
  const header = (lines[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const need = ['date', 'kind', 'category', 'amount'].filter((n) => col(n) < 0);
  if (!lines.length || need.length) {
    return { rows: [], problems: [{ row: 1, message: `This doesn't look like a MonthLedger backup (missing ${need.join(', ') || 'a header row'}).` }] };
  }
  const byName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c]));
  const goalByName = new Map(goals.map((g) => [g.name.trim().toLowerCase(), g]));
  const rows: ImportRow[] = [];
  lines.slice(1).forEach((cells, i) => {
    const row = i + 2;
    const get = (name: string) => { const at = col(name); return at < 0 ? '' : unguard((cells[at] ?? '').trim()); };
    if (cells.every((c) => !c.trim())) return;   // blank line
    const date = parseDate(get('date'));
    if (!date) { problems.push({ row, message: `Date "${get('date')}" isn't a date (use 2026-11-05 or 05/11/2026).` }); return; }
    const kind = KINDS[get('kind').toUpperCase()];
    if (!kind) { problems.push({ row, message: `Kind "${get('kind')}" should be Income, Expense, Saving or Withdrawal.` }); return; }
    const amount = Number(get('amount').replace(/[₹,\s]/g, ''));
    if (!(amount > 0)) { problems.push({ row, message: `Amount "${get('amount')}" should be a number above 0.` }); return; }
    const category = byName.get(get('category').toLowerCase());
    if (!category) { problems.push({ row, message: `Unknown category "${get('category')}". Add it in Categories & limits, then import again.` }); return; }
    const mode = get('payment').toUpperCase();
    const goal = get('goal') ? goalByName.get(get('goal').toLowerCase()) : undefined;
    rows.push({
      row, date, kind, amount, categoryId: category.id,
      paymentMode: MODES.includes(mode as PaymentMode) ? mode as PaymentMode : null,
      note: get('note') || null,
      goalId: goal && (kind === 'SAVING' || kind === 'SAVING_WITHDRAWAL') ? goal.id : null,
    });
  });
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.row - b.row);
  return { rows, problems };
}
