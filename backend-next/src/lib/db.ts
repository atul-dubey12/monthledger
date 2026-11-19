import { Pool, types } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
export interface Database {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}
export interface TransactionDatabase extends Database {
  transaction<T>(work: (db: Database) => Promise<T>): Promise<T>;
}
export const dateTypes = { getTypeParser: (oid: number, format?: 'text' | 'binary') => oid === 1082 ? (value: string) => value : types.getTypeParser(oid, format) };
let pool: Pool | undefined;
function getPool(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000, types: dateTypes });
    pool.on('error', () => console.error('Idle database connection failed'));
    if (process.env.VERCEL) attachDatabasePool(pool);
  }
  return pool;
}
export function withTransactions(connectionPool: Pool): TransactionDatabase {
  return {
    query: (text, values) => connectionPool.query(text, values),
    async transaction<T>(work: (db: Database) => Promise<T>): Promise<T> {
      const client = await connectionPool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
  };
}
export const database: TransactionDatabase = {
  query: (text, values) => getPool().query(text, values),
  transaction: work => withTransactions(getPool()).transaction(work),
};
// Keep the Angular JSON contract. Monetary arithmetic stays in PostgreSQL NUMERIC.
const numericFields = new Set(['id', 'categoryId', 'goalId', 'recurringId', 'amount', 'monthlyBudget', 'targetAmount', 'startingAmount', 'saved']);
export function apiRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    const name = key === 'entry_date' ? 'date' : key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
    return [name, value != null && numericFields.has(name) ? Number(value) : value];
  }));
}
