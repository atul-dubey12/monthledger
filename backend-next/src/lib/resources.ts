import { type Database, apiRow } from './db';
import { ApiError, bad, text, flag, integer, choice, buckets, kinds, payments, allows, money, decimal, date, yearsFromToday, label, icon } from './validation';
type Body = Record<string, unknown>;
export async function find(db: Database, table: 'categories' | 'goals' | 'recurring' | 'entries', id: number, message: string, status = 400): Promise<Body> {
  const row = (await db.query(`SELECT * FROM ${table} WHERE id = $1`, [id])).rows[0];
  if (!row) throw new ApiError(status, message);
  return row;
}
export async function settings(db: Database, body?: Body) {
  if (body) {
    const name = text(body.name) || '';
    if (name.length > 30) bad('Name can be up to 30 characters.');
    const needs = integer(body.needsPercent), wants = integer(body.wantsPercent), savings = integer(body.savingsPercent);
    if (needs == null || wants == null || savings == null) bad('Set a percentage for needs, wants and savings.');
    if (needs < 0 || wants < 0 || savings < 0) bad('Percentages cannot be negative.');
    if (needs + wants + savings !== 100) bad('Needs, wants and savings must add up to 100%.');
    const day = integer(body.monthStartDay);
    if (day == null || day < 1 || day > 28) bad('Month start day must be between 1 and 28.');
    await db.query('UPDATE settings SET name=$1, needs_percent=$2, wants_percent=$3, savings_percent=$4, month_start_day=$5 WHERE id=1', [name, needs, wants, savings, day]);
  }
  const row = (await db.query('SELECT * FROM settings WHERE id=1')).rows[0];
  if (!row) throw new ApiError(500, 'Settings row is missing.');
  return apiRow(row);
}
export async function categories(db: Database, body?: Body, id?: number) {
  if (!body) return (await db.query('SELECT * FROM categories ORDER BY sort_order, id')).rows.map(apiRow);
  const name = label(body.name, 'Give the category a name.', 'Category names can be up to 40 characters.');
  const emoji = icon(body.icon, '•'), bucket = choice(body.bucket, buckets);
  if (!bucket) bad('Choose Needs, Wants, Savings or Income.');
  const budget = decimal(body.monthlyBudget);
  if (budget && (budget.lt(0) || budget.gt(10_000_000))) bad('Budget must be between ₹0 and ₹1,00,00,000.');
  if (budget && budget.decimalPlaces() > 2) bad('Budget can have at most 2 decimal places.');
  const archived = flag(body.archived);
  const existing = id === undefined ? null : await find(db, 'categories', id, 'Category not found.', 404);
  if (!existing || String(existing.name).toLowerCase() !== name.toLowerCase()) {
    if ((await db.query('SELECT id FROM categories WHERE lower(name)=lower($1) AND archived=false LIMIT 1', [name])).rows.length) bad('A category with this name already exists.');
  }
  if (existing && existing.bucket !== bucket && (await db.query('SELECT id FROM entries WHERE category_id=$1 LIMIT 1', [id])).rows.length) bad("This category already has entries, so it can't move to another bucket. Add a new category instead.");
  const values = [name, emoji, bucket, budget?.toFixed(2) ?? null];
  const result = existing
    ? await db.query('UPDATE categories SET name=$1, icon=$2, bucket=$3, monthly_budget=$4, archived=$5 WHERE id=$6 RETURNING *', [...values, archived ?? existing.archived, id])
    : await db.query('INSERT INTO categories(name,icon,bucket,monthly_budget,sort_order) SELECT $1,$2,$3,$4,coalesce(max(sort_order),0)+10 FROM categories RETURNING *', values);
  return apiRow(result.rows[0]);
}
const goalView = `SELECT g.*, g.starting_amount + coalesce((SELECT sum(CASE WHEN e.kind='SAVING_WITHDRAWAL' THEN -e.amount ELSE e.amount END) FROM entries e WHERE e.goal_id=g.id),0) AS saved FROM goals g`;
export async function goals(db: Database, body?: Body, id?: number) {
  if (!body) return (await db.query(`${goalView} ORDER BY g.archived, g.id`)).rows.map(apiRow);
  const name = label(body.name, 'Give the goal a name.', 'Goal names can be up to 40 characters.');
  const emoji = icon(body.icon, '🎯'), target = money(body.targetAmount, 'target');
  const starting = money(body.startingAmount ?? 0, 'already saved amount', false), targetDate = date(body.targetDate);
  if (targetDate && targetDate > yearsFromToday(50)) bad('That target date is too far away.');
  const archived = flag(body.archived);
  const existing = id === undefined ? null : await find(db, 'goals', id, 'This goal no longer exists.', 404);
  const values = [name, emoji, target, starting, targetDate];
  const result = existing
    ? await db.query('UPDATE goals SET name=$1,icon=$2,target_amount=$3,starting_amount=$4,target_date=$5,archived=$6 WHERE id=$7 RETURNING id', [...values, archived ?? existing.archived, id])
    : await db.query('INSERT INTO goals(name,icon,target_amount,starting_amount,target_date) VALUES($1,$2,$3,$4,$5) RETURNING id', values);
  return apiRow((await db.query(`${goalView} WHERE g.id=$1`, [result.rows[0].id])).rows[0]);
}
export async function recurring(db: Database, body?: Body, id?: number) {
  if (!body) return (await db.query('SELECT * FROM recurring WHERE active=true ORDER BY day_of_month, id')).rows.map(apiRow);
  const existing = id === undefined ? null : await find(db, 'recurring', id, 'This item no longer exists.', 404);
  const name = label(body.name, 'Give it a name, e.g. Gym fee.', 'Names can be up to 40 characters.');
  const kind = choice(body.kind, kinds);
  if (!kind || kind === 'SAVING_WITHDRAWAL') bad('Choose income, expense or saving.');
  const amount = money(body.amount), day = integer(body.dayOfMonth);
  if (day == null || day < 1 || day > 31) bad('Pick a day between 1 and 31.');
  const categoryId = integer(body.categoryId);
  if (categoryId == null) bad('Pick a category.');
  const category = await find(db, 'categories', categoryId, 'That category no longer exists.');
  if (category.archived) bad('That category is hidden. Pick another one.');
  if (!allows(kind, category.bucket)) bad(`${category.name} can't be used for this kind of item.`);
  const requestedGoal = integer(body.goalId), goalId = kind === 'SAVING' ? requestedGoal : null;
  if (goalId != null && (await find(db, 'goals', goalId, 'That goal no longer exists.')).archived) bad('That goal is hidden. Pick another one.');
  const payment = choice(body.paymentMode, payments), active = flag(body.active);
  const values = [name, kind, amount, categoryId, goalId, day, payment];
  const result = existing
    ? await db.query('UPDATE recurring SET name=$1,kind=$2,amount=$3,category_id=$4,goal_id=$5,day_of_month=$6,payment_mode=$7,active=$8 WHERE id=$9 RETURNING *', [...values, active ?? existing.active, id])
    : await db.query('INSERT INTO recurring(name,kind,amount,category_id,goal_id,day_of_month,payment_mode) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *', values);
  return apiRow(result.rows[0]);
}
