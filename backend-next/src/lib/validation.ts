import Decimal from 'decimal.js';
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function bad(message: string): never { throw new ApiError(400, message); }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad('Some fields have the wrong format.');
  return value as Record<string, unknown>;
}
export function text(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') bad('Some fields have the wrong format.');
  return value.trim();
}
export function flag(value: unknown): boolean | null {
  if (value == null) return null;
  if (typeof value !== 'boolean') bad('Some fields have the wrong format.');
  return value;
}
export function integer(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) bad('Some fields have the wrong format.');
  return value;
}
export function choice(value: unknown, choices: readonly string[]): string | null {
  if (value == null) return null;
  if (typeof value !== 'string' || !choices.includes(value)) bad('Some fields have the wrong format.');
  return value;
}
export const kinds = ['INCOME', 'EXPENSE', 'SAVING', 'SAVING_WITHDRAWAL'];
export const buckets = ['INCOME', 'NEED', 'WANT', 'SAVING'];
export const payments = ['UPI', 'CARD', 'CASH', 'BANK'];
export function allows(kind: string, bucket: unknown): boolean {
  return kind === 'EXPENSE' ? bucket === 'NEED' || bucket === 'WANT' : bucket === (kind === 'SAVING_WITHDRAWAL' ? 'SAVING' : kind);
}
export function decimal(value: unknown): Decimal | null {
  if (value == null) return null;
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(String(value))) bad('Some fields have the wrong format.');
  const result = new Decimal(value);
  if (!result.isFinite()) bad('Some fields have the wrong format.');
  return result;
}
export function money(value: unknown, what?: string, positive = true): string {
  const amount = decimal(value);
  if (!amount || (positive ? amount.lte(0) : amount.lt(0))) bad(what ? `Enter a ${what}${positive ? ' greater than ₹0.' : ' of ₹0 or more.'}` : 'Enter an amount greater than ₹0.');
  if (amount.gt(100_000_000)) bad(what ? `That ${what} is too large.` : 'That amount is too large.');
  if (amount.decimalPlaces() > 2) bad('Amounts can have at most 2 decimal places (paise).');
  return amount.toFixed(2);
}
export function date(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) bad('Some fields have the wrong format.');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value < '0001-01-01') bad('Some fields have the wrong format.');
  return value;
}
export function today(): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: process.env.APP_TIME_ZONE || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function yearsFromToday(years: number): string {
  const current = today(), year = Number(current.slice(0, 4)) + years;
  return current.endsWith('-02-29') && (year % 4 !== 0 || (year % 100 === 0 && year % 400 !== 0)) ? `${year}-02-28` : `${year}${current.slice(4)}`;
}
export function label(value: unknown, empty: string, long: string): string {
  const name = text(value);
  if (!name) bad(empty);
  if (name.length > 40) bad(long);
  return name;
}
export function icon(value: unknown, fallback: string): string {
  const result = text(value);
  if (result && result.length > 8) bad('Pick a single emoji for the icon.');
  return result || fallback;
}
