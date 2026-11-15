import { Bucket, Category, Entry, Goal, Recurring } from './models';

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

export interface TrendMonth { key: string; label: string; income: number; saved: number; rate: number | null; }

/** Income, net saved and savings rate per budget month, oldest first. `months` are [key, label, start, end-exclusive]. */
export function savingsTrend(entries: Entry[], months: { key: string; label: string; start: Date; end: Date }[], categories: Map<number, Category>): TrendMonth[] {
  return months.map((m) => {
    const from = isoOf(m.start), to = isoOf(m.end);
    const t = monthTotals(entries.filter((e) => e.date >= from && e.date < to), categories);
    return { key: m.key, label: m.label, income: t.income, saved: t.saved, rate: t.savingsRate };
  });
}

/** How much a goal still needs per month to hit its date, from this budget month on. */
export function goalPlan(goal: Goal, monthsLeft: number | null): { left: number; percent: number; perMonth: number | null; state: 'reached' | 'onTrack' | 'noDate' | 'late' } {
  const left = money(Math.max(0, goal.targetAmount - goal.saved));
  const percent = Math.max(0, Math.min(100, Math.round((goal.saved / goal.targetAmount) * 100)));
  if (left === 0) return { left, percent: 100, perMonth: null, state: 'reached' };
  if (monthsLeft === null) return { left, percent, perMonth: null, state: 'noDate' };
  if (monthsLeft <= 0) return { left, percent, perMonth: null, state: 'late' };
  return { left, percent, perMonth: Math.ceil(left / monthsLeft), state: 'onTrack' };
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type DueState = 'paid' | 'overdue' | 'soon' | 'upcoming';
export interface DueItem { item: Recurring; due: Date; dueIso: string; state: DueState; paidBy: Entry | null; daysAway: number; }

/** The date a monthly item falls on inside a budget month that starts on `startDay` (5 → 5 Nov – 4 Dec). */
export function dueDateIn(item: Recurring, monthStart: Date, startDay: number): Date {
  const y = monthStart.getFullYear(), m = monthStart.getMonth();
  const inNext = item.dayOfMonth < startDay;
  const year = inNext && m === 11 ? y + 1 : y, month = inNext ? (m + 1) % 12 : m;
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(item.dayOfMonth, last));
}

/**
 * Which monthly items are paid in a month. An entry paid from the list (recurringId) counts exactly;
 * otherwise an entry logged by hand with the same kind and category and a similar amount (half to
 * one-and-a-half times) counts, so nothing is asked for twice. Each entry pays at most one item.
 */
export function dueItems(items: Recurring[], entries: Entry[], monthStart: Date, startDay: number, today: Date): DueItem[] {
  const claimed = new Set<number>();
  const paid = new Map<number, Entry>();
  for (const item of items) {
    const exact = entries.find((e) => e.recurringId === item.id && !claimed.has(e.id));
    if (exact) { paid.set(item.id, exact); claimed.add(exact.id); }
  }
  for (const item of items) {
    if (paid.has(item.id)) continue;
    const manual = entries.find((e) => !e.recurringId && !claimed.has(e.id) && e.kind === item.kind && e.categoryId === item.categoryId
      && e.amount >= item.amount * 0.5 && e.amount <= item.amount * 1.5);
    if (manual) { paid.set(item.id, manual); claimed.add(manual.id); }
  }
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return items.map((item) => {
    const due = dueDateIn(item, monthStart, startDay);
    const daysAway = Math.round((due.getTime() - day.getTime()) / 86_400_000);
    const paidBy = paid.get(item.id) ?? null;
    const state: DueState = paidBy ? 'paid' : daysAway < 0 ? 'overdue' : daysAway <= 3 ? 'soon' : 'upcoming';
    return { item, due, dueIso: isoOf(due), state, paidBy, daysAway };
  }).sort((a, b) => a.due.getTime() - b.due.getTime() || a.item.id - b.item.id);
}

/** Bills and savings still to come out this month (income still to come in is not counted). */
export function stillDue(list: DueItem[]): number {
  return money(list.filter((d) => d.state !== 'paid' && d.item.kind !== 'INCOME').reduce((sum, d) => sum + d.item.amount, 0));
}
