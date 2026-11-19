import nextEnv from '@next/env';
import { Pool } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
nextEnv.loadEnvConfig(process.cwd());
const command = process.argv[2];
if (!['check', 'init'].includes(command)) throw new Error('Use db:check or db:init.');
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before running this command.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10_000 });
let client;
try {
  client = await pool.connect();
  if (command === 'init') {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(89142321)');
    const existing = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE'`);
    if (existing.rows.length) throw new Error('Refusing to initialize a nonempty schema. Existing Neon databases only need db:check.');
    const directory = path.join(process.cwd(), 'migrations');
    for (const name of (await readdir(directory)).filter(n => /^V\d+__.*\.sql$/.test(n)).sort((a, b) => Number(a.match(/^V(\d+)/)![1]) - Number(b.match(/^V(\d+)/)![1]))) await client.query(await readFile(path.join(directory, name), 'utf8'));
    await client.query('COMMIT');
    console.log('Initialized an empty PostgreSQL schema.');
  }
  await client.query('SELECT id,name,icon,bucket,monthly_budget,sort_order,archived FROM categories LIMIT 0');
  await client.query('SELECT id,entry_date,kind,amount,category_id,payment_mode,note,goal_id,recurring_id FROM entries LIMIT 0');
  await client.query('SELECT id,name,icon,target_amount,starting_amount,target_date,archived FROM goals LIMIT 0');
  await client.query('SELECT id,name,kind,amount,category_id,goal_id,day_of_month,payment_mode,active FROM recurring LIMIT 0');
  const settings = await client.query('SELECT id,name,needs_percent,wants_percent,savings_percent,month_start_day FROM settings WHERE id=1');
  if (settings.rows.length !== 1) throw new Error('Settings row is missing.');
  console.log('Schema is compatible with the Next.js backend.');
} catch (error) {
  if (client && command === 'init') await client.query('ROLLBACK');
  console.error(error instanceof Error && /Refusing|Settings row/.test(error.message) ? error.message : 'Database check failed. Verify the connection and that the existing V1–V5 schema is present.');
  process.exitCode = 1;
} finally { client?.release(); await pool.end(); }
