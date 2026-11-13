import { BudgetSettings, Category, Entry, Goal } from './models';

/**
 * The last data this device loaded from the server, shown instantly on the next visit while a
 * sleeping free-tier server wakes up (up to a minute). The server stays the source of truth:
 * everything here is replaced as soon as fresh data arrives. Never written to by the user directly.
 */
export interface Snapshot {
  savedAt: string;
  settings: BudgetSettings;
  categories: Category[];
  goals: Goal[];
  trendEntries: Entry[];
  /** Entries per budget month key ("2026-11"), most recently used last. */
  months: Record<string, Entry[]>;
}

const KEY = 'monthledger.snapshot';
/** Current + previous month plus a little browsing history; keeps localStorage small. */
const MAX_MONTHS = 4;

export function readSnapshot(): Snapshot | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as Snapshot;
    return snap && snap.settings && Array.isArray(snap.categories) ? snap : null;
  } catch { return null; }
}

/** Merges `patch` into the stored snapshot. Month entries are merged by key and trimmed to the newest few. */
export function writeSnapshot(patch: Partial<Omit<Snapshot, 'savedAt'>>): void {
  try {
    const current = readSnapshot();
    const months = { ...(current?.months ?? {}) };
    for (const [key, entries] of Object.entries(patch.months ?? {})) { delete months[key]; months[key] = entries; }
    const keys = Object.keys(months);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_MONTHS))) delete months[old];
    const next = { settings: current?.settings, categories: current?.categories ?? [], goals: current?.goals ?? [], trendEntries: current?.trendEntries ?? [], ...patch, months, savedAt: new Date().toISOString() };
    if (!next.settings) return;   // nothing useful to show yet
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* storage full or blocked: the app still works, just without the instant start */ }
}

export function clearSnapshot(): void {
  try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}
