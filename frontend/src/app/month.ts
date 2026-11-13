/**
 * A budget month starts on salary day. With startDay 5, "November 2026" runs 5 Nov – 4 Dec,
 * and 3 Dec still belongs to November. Pure functions, no Angular.
 */
export interface BudgetMonth {
  /** yyyy-MM of the month it starts in, e.g. "2026-11". */
  key: string;
  start: Date;
  /** Exclusive: the first day of the next budget month. */
  end: Date;
}

const pad = (n: number) => String(n).padStart(2, '0');

function startingIn(year: number, month: number, startDay: number): BudgetMonth {
  const start = new Date(year, month, startDay);
  const end = new Date(year, month + 1, startDay);
  return { key: `${start.getFullYear()}-${pad(start.getMonth() + 1)}`, start, end };
}

export function budgetMonthFor(date: Date, startDay: number): BudgetMonth {
  const before = date.getDate() < startDay;
  return startingIn(date.getFullYear(), date.getMonth() - (before ? 1 : 0), startDay);
}

export function shiftMonth(month: BudgetMonth, by: number, startDay: number): BudgetMonth {
  return startingIn(month.start.getFullYear(), month.start.getMonth() + by, startDay);
}

export function contains(month: BudgetMonth, date: Date): boolean {
  return date >= month.start && date < month.end;
}

/** Days from today through the last day of the month, counting today; 0 when the month is over or not started. */
export function daysLeft(month: BudgetMonth, today: Date): number {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!contains(month, day)) return 0;
  return Math.round((month.end.getTime() - day.getTime()) / 86_400_000);
}

export function totalDays(month: BudgetMonth): number {
  return Math.round((month.end.getTime() - month.start.getTime()) / 86_400_000);
}

/** "November 2026" — named after the month salary arrives in. */
export function monthName(month: BudgetMonth): string {
  return month.start.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/** "5 Nov – 4 Dec"; empty when months follow the calendar (start day 1), where the name says it all. */
export function monthRange(month: BudgetMonth): string {
  if (month.start.getDate() === 1) return '';
  const last = new Date(month.end.getFullYear(), month.end.getMonth(), month.end.getDate() - 1);
  const short = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `${short(month.start)} – ${short(last)}`;
}

export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Budget months from `from` to `to`, counting both (Nov → Dec = 2). Zero or less when `to` is earlier. */
export function monthsBetween(from: BudgetMonth, to: BudgetMonth): number {
  return (to.start.getFullYear() * 12 + to.start.getMonth()) - (from.start.getFullYear() * 12 + from.start.getMonth()) + 1;
}

/** "Nov" — short name for chart labels. */
export function shortMonth(month: BudgetMonth): string {
  return month.start.toLocaleDateString('en-IN', { month: 'short' });
}
