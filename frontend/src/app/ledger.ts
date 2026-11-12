import { Bucket, Category, Entry } from './models';

export interface MonthTotals {
  income: number;
  needs: number;
  wants: number;
  /** needs + wants */
  spent: number;
  /** Put into savings minus taken out. Can be negative in a month you dipped into savings. */
  saved: number;
  /** income − spent − saved: what is still free to spend this month. */
  left: number;
  /** saved as a % of income, or null with no income yet. */
  savingsRate: number | null;
}

/** Rounds to paise so sums of decimals don't drift (0.1 + 0.2). */
const money = (n: number) => Math.round(n * 100) / 100;

export function monthTotals(entries: Entry[], categories: Map<number, Category>): MonthTotals {
  let income = 0, needs = 0, wants = 0, saved = 0;
  for (const e of entries) {
    if (e.kind === 'INCOME') income += e.amount;
    else if (e.kind === 'SAVING') saved += e.amount;
    else if (e.kind === 'SAVING_WITHDRAWAL') saved -= e.amount;
    else if (categories.get(e.categoryId)?.bucket === 'WANT') wants += e.amount;
    else needs += e.amount;
  }
  const spent = needs + wants;
  return {
    income: money(income), needs: money(needs), wants: money(wants), spent: money(spent), saved: money(saved),
    left: money(income - spent - saved), savingsRate: income > 0 ? Math.round((saved / income) * 100) : null,
  };
}

/** The bucket an entry counts toward on the plan. */
export function entryBucket(entry: Entry, categories: Map<number, Category>): Bucket {
  return categories.get(entry.categoryId)?.bucket ?? (entry.kind === 'INCOME' ? 'INCOME' : entry.kind === 'EXPENSE' ? 'NEED' : 'SAVING');
}

/** Groups newest-first entries by date, keeping that order. */
export function byDay(entries: Entry[]): { date: string; entries: Entry[] }[] {
  const groups: { date: string; entries: Entry[] }[] = [];
  for (const e of entries) {
    const last = groups[groups.length - 1];
    if (last?.date === e.date) last.entries.push(e); else groups.push({ date: e.date, entries: [e] });
  }
  return groups;
}

export function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
