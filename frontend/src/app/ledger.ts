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

/** Net amount per category: expenses and savings add, withdrawals subtract. Income is left out. */
export function categoryAmounts(entries: Entry[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const e of entries) {
    if (e.kind === 'INCOME') continue;
    const sign = e.kind === 'SAVING_WITHDRAWAL' ? -1 : 1;
    out.set(e.categoryId, money((out.get(e.categoryId) ?? 0) + sign * e.amount));
  }
  return out;
}

export type BudgetLevel = 'ok' | 'warn' | 'over';
export interface BudgetStatus { category: Category; spent: number; limit: number; percent: number; level: BudgetLevel; }

/** Warn from 80% of a limit up to just below it; "over" once past it. Only categories with a limit are returned. */
export function budgetStatuses(categories: Category[], amounts: Map<number, number>): BudgetStatus[] {
  return categories.filter((c) => !c.archived && c.bucket !== 'INCOME' && c.bucket !== 'SAVING' && (c.monthlyBudget ?? 0) > 0).map((c) => {
    const spent = amounts.get(c.id) ?? 0;
    const limit = c.monthlyBudget!;
    const percent = Math.round((spent / limit) * 100);
    // Exactly at the limit is a planned bill paid in full (home money, gym fee), not a warning.
    return { category: c, spent, limit, percent, level: spent > limit ? 'over' : percent >= 80 && spent < limit ? 'warn' : 'ok' };
  });
}

export interface DayBar { iso: string; date: Date; needs: number; wants: number; }

/** One bar per day of the budget month (start inclusive, end exclusive). */
export function dailySpending(entries: Entry[], start: Date, end: Date, categories: Map<number, Category>): DayBar[] {
  const days: DayBar[] = [];
  const index = new Map<string, DayBar>();
  for (let d = new Date(start); d < end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const bar = { iso, date: d, needs: 0, wants: 0 };
    days.push(bar);
    index.set(iso, bar);
  }
  for (const e of entries) {
    const bar = index.get(e.date);
    if (!bar || e.kind !== 'EXPENSE') continue;
    if (categories.get(e.categoryId)?.bucket === 'WANT') bar.wants = money(bar.wants + e.amount); else bar.needs = money(bar.needs + e.amount);
  }
  return days;
}

/** % change from `before` to `now`; null when there is nothing to compare against. */
export function change(now: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}

/** The category whose amount grew the most between two months, for "mostly Eating out". */
export function biggestRise(now: Map<number, number>, before: Map<number, number>, ids: Set<number>): { id: number; rise: number } | null {
  let best: { id: number; rise: number } | null = null;
  for (const id of ids) {
    const rise = (now.get(id) ?? 0) - (before.get(id) ?? 0);
    if (rise > 0 && (!best || rise > best.rise)) best = { id, rise: money(rise) };
  }
  return best;
}
