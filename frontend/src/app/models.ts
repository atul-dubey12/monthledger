export type Bucket = 'INCOME' | 'NEED' | 'WANT' | 'SAVING';

export interface Category {
  id: number;
  name: string;
  icon: string;
  bucket: Bucket;
  monthlyBudget: number | null;
  sortOrder: number;
  archived: boolean;
}

/** Shared across devices (stored on the server). Theme is per device and lives in localStorage. */
export interface BudgetSettings {
  name: string;
  needsPercent: number;
  wantsPercent: number;
  savingsPercent: number;
  monthStartDay: number;
}

export const BUCKETS: { key: Exclude<Bucket, 'INCOME'>; label: string; percentKey: keyof BudgetSettings; hint: string }[] = [
  { key: 'NEED', label: 'Needs', percentKey: 'needsPercent', hint: 'Rent, bills, groceries, EMI — what you must pay' },
  { key: 'WANT', label: 'Wants', percentKey: 'wantsPercent', hint: 'Eating out, shopping, fun — nice, but optional' },
  { key: 'SAVING', label: 'Savings', percentKey: 'savingsPercent', hint: 'Emergency fund, SIPs, goals — pay yourself first' },
];
