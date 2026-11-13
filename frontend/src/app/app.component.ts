import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import {
  LucideAngularModule, ArrowDownLeft, ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight, LayoutDashboard, Moon, PiggyBank,
  Settings2, ShieldCheck, Sun, Target, Timer, Wallet, X, CircleAlert, Receipt, Plus, Search, Trash2, Pencil, Undo2, Zap, Tags, TrendingUp, TrendingDown, BarChart3, Flag
} from 'lucide-angular';
import { NetworkStatus, readApiKey, saveApiKey } from './api.interceptor';
import { BudgetService } from './budget.service';
import { BUCKETS, Bucket, BudgetSettings, Category, Entry, EntryKind, Goal, GoalDraft, PAYMENT_MODES } from './models';
import { budgetMonthFor, contains, daysLeft, isoDate, monthName, monthRange, monthsBetween, shiftMonth, shortMonth, totalDays } from './month';
import { biggestRise, budgetStatuses, byDay, categoryAmounts, change, dailySpending, entryBucket, goalPlan, monthTotals, parseIso, savingsTrend } from './ledger';
import { EntrySheetComponent } from './entry-sheet.component';
import { QuickExpenseComponent } from './quick-expense.component';
import { CategoriesSheetComponent } from './categories-sheet.component';
import { GoalSheetComponent } from './goal-sheet.component';
import { Snapshot, clearSnapshot, readSnapshot, writeSnapshot } from './cache';

type Theme = 'system' | 'light' | 'dark';
interface Toast { message: string; actionLabel?: string; action?: () => void; }
type ActivityFilter = 'ALL' | 'INCOME' | 'NEED' | 'WANT' | 'SAVING';

const THEME_KEY = 'monthledger.theme';
const TREND_MONTHS = 6;
const DEFAULT_SETTINGS: BudgetSettings = { name: '', needsPercent: 50, wantsPercent: 30, savingsPercent: 20, monthStartDay: 5 };

@Component({
  selector: 'app-root',
  imports: [FormsModule, CurrencyPipe, DatePipe, LucideAngularModule, EntrySheetComponent, QuickExpenseComponent, CategoriesSheetComponent, GoalSheetComponent],
  templateUrl: './app.component.html'
})
export class AppComponent {
  readonly icons = {
    ArrowDownLeft, ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight, LayoutDashboard, Moon, PiggyBank, Settings2, ShieldCheck,
    Sun, Target, Timer, Wallet, X, CircleAlert, Receipt, Plus, Search, Trash2, Pencil, Undo2, Zap, Tags, TrendingUp, TrendingDown, BarChart3, Flag
  };
  readonly buckets = BUCKETS;
  private readonly service = inject(BudgetService);
  readonly slowNetwork = inject(NetworkStatus).slow;

  // ── Server data ───────────────────────────────────────────
  readonly settings = signal<BudgetSettings>(DEFAULT_SETTINGS);
  readonly categories = signal<Category[]>([]);
  readonly entries = signal<Entry[]>([]);
  /** The month before the one on screen, for "compared with last month". */
  readonly previousEntries = signal<Entry[]>([]);
  readonly goals = signal<Goal[]>([]);
  /** The last TREND_MONTHS budget months of entries, for the savings-rate trend. */
  readonly trendEntries = signal<Entry[]>([]);
  /** Which budget month `entries` holds, so a slow response for another month is ignored. */
  private entriesFor = '';
  readonly entriesLoading = signal(false);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly needsKey = signal(false);
  /** Set while the page shows this device's saved copy and the server hasn't answered yet. */
  readonly savedCopyFrom = signal<Date | null>(null);
  /** Entries from the saved copy, per month key, so browsing months works while the server wakes. */
  private cachedMonths: Snapshot['months'] = {};

  // ── Per device ────────────────────────────────────────────
  readonly theme = signal<Theme>(this.loadTheme());
  readonly isDark = computed(() => this.theme() === 'dark' || (this.theme() === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches));
  readonly apiKeyDraft = signal(readApiKey());
  readonly showKey = signal(false);

  // ── Month ─────────────────────────────────────────────────
  private readonly today = new Date();
  /** How many months back from the current one we're looking at (0 = current). */
  readonly monthOffset = signal(0);
  readonly month = computed(() => shiftMonth(budgetMonthFor(this.today, this.settings().monthStartDay), this.monthOffset(), this.settings().monthStartDay));
  readonly monthName = computed(() => monthName(this.month()));
  readonly monthRange = computed(() => monthRange(this.month()));
  readonly isCurrentMonth = computed(() => contains(this.month(), this.today));
  readonly daysLeft = computed(() => daysLeft(this.month(), this.today));
  readonly monthProgress = computed(() => this.isCurrentMonth()
    ? Math.round(((totalDays(this.month()) - this.daysLeft() + 1) / totalDays(this.month())) * 100) : 100);

  // ── Numbers ───────────────────────────────────────────────
  readonly categoryById = computed(() => new Map(this.categories().map((c) => [c.id, c])));
  readonly totals = computed(() => monthTotals(this.entries(), this.categoryById()));
  /** What can still be spent per day for the rest of this month without eating into savings. */
  readonly perDay = computed(() => this.isCurrentMonth() && this.daysLeft() > 0 && this.totals().left > 0 ? this.totals().left / this.daysLeft() : null);

  // ── Budgets ───────────────────────────────────────────────
  readonly amounts = computed(() => categoryAmounts(this.entries()));
  /** Every category with a limit, fullest first. */
  readonly budgets = computed(() => budgetStatuses(this.categories(), this.amounts()).sort((a, b) => b.percent - a.percent));
  readonly budgetAlerts = computed(() => this.budgets().filter((b) => b.level !== 'ok').length);

  // ── Chart ─────────────────────────────────────────────────
  readonly chartMode = signal<'WANT' | 'ALL'>('WANT');
  readonly chartDays = computed(() => dailySpending(this.entries(), this.month().start, this.month().end, this.categoryById()));
  readonly chartMax = computed(() => Math.max(1, ...this.chartDays().map((d) => this.chartMode() === 'WANT' ? d.wants : d.needs + d.wants)));
  readonly hoveredDay = signal<string | null>(null);
  readonly hoveredBar = computed(() => this.chartDays().find((d) => d.iso === this.hoveredDay()) ?? null);
  /** Tapping a bar shows only that day's entries in Activity. */
  readonly dayFilter = signal<string | null>(null);

  // ── Compared with last month ──────────────────────────────
  /** For the month in progress, compare with the same number of days of last month (5–12 Nov vs 5–12 Oct). */
  readonly previousComparable = computed(() => {
    const prev = shiftMonth(this.month(), -1, this.settings().monthStartDay);
    if (!this.isCurrentMonth()) return this.previousEntries();
    const elapsed = totalDays(this.month()) - this.daysLeft() + 1;
    const cutoff = isoDate(new Date(prev.start.getFullYear(), prev.start.getMonth(), prev.start.getDate() + elapsed));
    return this.previousEntries().filter((e) => e.date < cutoff);
  });
  readonly comparison = computed(() => {
    if (!this.previousEntries().length) return null;
    const now = this.totals();
    const before = monthTotals(this.previousComparable(), this.categoryById());
    const wantIds = new Set(this.categories().filter((c) => c.bucket === 'WANT').map((c) => c.id));
    const rise = biggestRise(this.amounts(), categoryAmounts(this.previousComparable()), wantIds);
    return {
      label: this.isCurrentMonth() ? 'same point last month' : 'the month before',
      spent: { now: now.spent, before: before.spent, change: change(now.spent, before.spent) },
      wants: { now: now.wants, before: before.wants, change: change(now.wants, before.wants) },
      rate: { now: now.savingsRate, before: before.savingsRate },
      rise: rise && now.wants > before.wants ? { name: this.categoryById().get(rise.id)?.name ?? '', amount: rise.rise } : null,
    };
  });

  // ── Goals & savings trend ─────────────────────────────────
  readonly activeGoals = computed(() => this.goals().filter((g) => !g.archived));
  readonly hiddenGoals = computed(() => this.goals().filter((g) => g.archived));
  readonly goalCards = computed(() => {
    const now = budgetMonthFor(this.today, this.settings().monthStartDay);
    return this.activeGoals().map((g) => {
      const months = g.targetDate ? monthsBetween(now, budgetMonthFor(parseIso(g.targetDate), this.settings().monthStartDay)) : null;
      return { goal: g, months, ...goalPlan(g, months) };
    });
  });
  /** Emergency fund suggestion: about 3 months of this month's spending, rounded up to ₹5,000. */
  readonly emergencySuggestion = computed<Partial<GoalDraft>>(() => {
    const spent = this.totals().spent;
    return { name: 'Emergency fund', icon: '🛟', targetAmount: spent > 0 ? Math.ceil((spent * 3) / 5000) * 5000 : 50000 };
  });
  readonly trend = computed(() => {
    const day = this.settings().monthStartDay;
    const current = budgetMonthFor(this.today, day);
    const months = Array.from({ length: TREND_MONTHS }, (_, i) => shiftMonth(current, i - TREND_MONTHS + 1, day))
      .map((m) => ({ key: m.key, label: shortMonth(m), start: m.start, end: m.end }));
    return savingsTrend(this.trendEntries(), months, this.categoryById());
  });
  readonly trendHasData = computed(() => this.trend().some((m) => m.income > 0 || m.saved !== 0));
  readonly trendMax = computed(() => Math.max(this.settings().savingsPercent, ...this.trend().map((m) => m.rate ?? 0), 1));

  // ── Plan ──────────────────────────────────────────────────
  readonly activeCategories = computed(() => this.categories().filter((c) => !c.archived));
  readonly incomeCategories = computed(() => this.activeCategories().filter((c) => c.bucket === 'INCOME'));
  readonly plan = computed(() => BUCKETS.map((b) => {
    const categories = this.activeCategories().filter((c) => c.bucket === b.key);
    const percent = this.settings()[b.percentKey] as number;
    const t = this.totals();
    const actual = b.key === 'NEED' ? t.needs : b.key === 'WANT' ? t.wants : t.saved;
    const target = (t.income * percent) / 100;
    // Per-category amounts this month, to show next to each category.
    const byCategory = new Map<number, number>();
    for (const e of this.entries()) {
      const sign = e.kind === 'SAVING_WITHDRAWAL' ? -1 : 1;
      if (e.kind !== 'INCOME') byCategory.set(e.categoryId, (byCategory.get(e.categoryId) ?? 0) + sign * e.amount);
    }
    return {
      ...b, percent, categories, actual, target,
      used: target > 0 ? Math.round((actual / target) * 100) : null,
      spentIn: (id: number) => byCategory.get(id) ?? 0,
    };
  }));

  // ── Activity ──────────────────────────────────────────────
  readonly filter = signal<ActivityFilter>('ALL');
  readonly search = signal('');
  readonly visibleEntries = computed(() => {
    const filter = this.filter();
    const query = this.search().trim().toLowerCase();
    const day = this.dayFilter();
    return this.entries().filter((e) => {
      if (day && e.date !== day) return false;
      if (filter !== 'ALL' && this.bucketOf(e) !== filter) return false;
      if (!query) return true;
      const c = this.categoryById().get(e.categoryId);
      return [e.note ?? '', c?.name ?? '', String(e.amount), e.paymentMode ?? ''].some((s) => s.toLowerCase().includes(query));
    });
  });
  readonly days = computed(() => byDay(this.visibleEntries()).map((d) => ({ ...d, day: parseIso(d.date) })));
  readonly todayIso = isoDate(new Date());
  readonly yesterdayIso = isoDate(new Date(Date.now() - 86_400_000));

  // ── Entry sheet ───────────────────────────────────────────
  /** undefined = closed. */
  readonly sheet = signal<{ kind: EntryKind; entry: Entry | null } | undefined>(undefined);
  readonly quickOpen = signal(false);
  /** undefined = closed; goal null = new goal (optionally from a suggestion). */
  readonly goalSheet = signal<{ goal: Goal | null; suggestion: Partial<GoalDraft> | null } | undefined>(undefined);
  /** Goal to pre-pick when the entry sheet opens from a goal's "Add money". */
  readonly sheetGoal = signal<number | null>(null);
  readonly categoriesOpen = signal(false);
  /** This month and last, so Quick expense can rank your usual categories. */
  readonly recentEntries = computed(() => [...this.entries(), ...this.previousEntries()]);
  /** New entries default to today, or to the last day of a past month being viewed. */
  readonly defaultDate = computed(() => this.isCurrentMonth() ? this.todayIso
    : isoDate(new Date(this.month().end.getFullYear(), this.month().end.getMonth(), this.month().end.getDate() - 1)));

  readonly greeting = computed(() => {
    const hour = new Date().getHours();
    const part = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    return `${part}, ${this.settings().name || 'there'}`;
  });

  // ── Settings sheet ────────────────────────────────────────
  readonly settingsOpen = signal(false);
  readonly draft = signal<BudgetSettings>(DEFAULT_SETTINGS);
  readonly draftTotal = computed(() => (this.draft().needsPercent || 0) + (this.draft().wantsPercent || 0) + (this.draft().savingsPercent || 0));
  readonly savingSettings = signal(false);
  readonly settingsError = signal('');

  readonly toast = signal<Toast | null>(null);
  private toastTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.service.wake();
    this.showSavedCopy();
    this.refresh();
    effect(() => {
      document.documentElement.dataset['theme'] = this.isDark() ? 'dark' : 'light';
      try { localStorage.setItem(THEME_KEY, this.theme()); } catch { /* storage blocked */ }
    });
  }

  /** Paints the last data this device saw, so the page is usable while a sleeping server wakes. */
  private showSavedCopy(): void {
    const snap = readSnapshot();
    if (!snap) return;
    this.settings.set(snap.settings);
    this.categories.set(snap.categories);
    this.goals.set(snap.goals);
    this.trendEntries.set(snap.trendEntries);
    this.cachedMonths = snap.months;
    const month = this.month();
    this.entriesFor = month.key;
    this.entries.set(snap.months[month.key] ?? []);
    this.previousEntries.set(snap.months[shiftMonth(month, -1, snap.settings.monthStartDay).key] ?? []);
    this.loading.set(false);
    this.savedCopyFrom.set(new Date(snap.savedAt));
  }
  /** Time of the saved copy, e.g. "10:42 am" today or "12 Nov, 9:15 pm" for older ones. */
  readonly savedCopyLabel = computed(() => {
    const at = this.savedCopyFrom();
    if (!at) return '';
    const time = at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    return isoDate(at) === this.todayIso ? time : `${at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time}`;
  });

  refresh(): void {
    if (!this.categories().length) this.loading.set(true);
    // Settings and categories in parallel; entries need the month start day from settings.
    forkJoin({ settings: this.service.settings(), categories: this.service.categories() }).subscribe({
      next: ({ settings, categories }) => {
        this.settings.set(settings);
        this.categories.set(categories);
        writeSnapshot({ settings, categories });
        this.loaded(); this.loadEntries(); this.loadGoals(); this.loadTrend();
      },
      error: (err) => this.failed(err),
    });
  }
  private loaded(): void { this.loading.set(false); this.error.set(''); this.needsKey.set(false); }
  private failed(err: unknown): void {
    this.loading.set(false);
    if (err instanceof HttpErrorResponse && err.status === 401) {
      // The key was changed or removed: don't keep showing data this device may no longer be allowed to see.
      clearSnapshot();
      this.cachedMonths = {};
      this.savedCopyFrom.set(null);
      this.entries.set([]); this.previousEntries.set([]); this.goals.set([]); this.trendEntries.set([]);
      this.error.set('');
      this.needsKey.set(true);
      this.openSettings();
      setTimeout(() => document.getElementById('server-key')?.focus());
      return;
    }
    this.error.set(this.savedCopyFrom()
      ? `Can't reach the server — showing your saved copy from ${this.savedCopyLabel()}. Check your signal and tap Retry.`
      : 'Could not reach the server. Check your signal and tap Retry.');
  }

  loadEntries(): void {
    const month = this.month();
    const key = month.key;
    const last = new Date(month.end.getFullYear(), month.end.getMonth(), month.end.getDate() - 1);
    if (this.entriesFor !== key) {
      const prevKey = shiftMonth(month, -1, this.settings().monthStartDay).key;
      this.entries.set(this.cachedMonths[key] ?? []); this.previousEntries.set(this.cachedMonths[prevKey] ?? []); this.dayFilter.set(null);
    }
    this.entriesFor = key;
    this.entriesLoading.set(true);
    this.service.entries(isoDate(month.start), isoDate(last)).subscribe({
      next: (entries) => {
        this.remember(key, entries);
        if (this.entriesFor !== key) return;
        this.entries.set(entries); this.entriesLoading.set(false);
        this.savedCopyFrom.set(null);   // the server answered: everything on screen is live now
      },
      error: (err) => { if (this.entriesFor !== key) return; this.entriesLoading.set(false); this.failed(err); },
    });
    const prev = shiftMonth(month, -1, this.settings().monthStartDay);
    this.service.entries(isoDate(prev.start), isoDate(new Date(prev.end.getFullYear(), prev.end.getMonth(), prev.end.getDate() - 1))).subscribe({
      next: (entries) => { this.remember(prev.key, entries); if (this.entriesFor === key) this.previousEntries.set(entries); },
      error: () => { /* the comparison card just stays hidden */ },
    });
  }

  loadGoals(): void {
    this.service.goals().subscribe({ next: (goals) => { this.goals.set(goals); writeSnapshot({ goals }); }, error: () => { /* goals panel keeps the last list */ } });
  }
  loadTrend(): void {
    const day = this.settings().monthStartDay;
    const current = budgetMonthFor(this.today, day);
    const first = shiftMonth(current, -(TREND_MONTHS - 1), day);
    const last = new Date(current.end.getFullYear(), current.end.getMonth(), current.end.getDate() - 1);
    this.service.entries(isoDate(first.start), isoDate(last)).subscribe({ next: (e) => { this.trendEntries.set(e); writeSnapshot({ trendEntries: e }); }, error: () => {} });
  }
  /** Keeps a month's fresh entries for the next instant start. */
  private remember(key: string, entries: Entry[]): void {
    const { [key]: _old, ...rest } = this.cachedMonths;
    this.cachedMonths = { ...rest, [key]: entries };
    writeSnapshot({ months: { [key]: entries } });
  }
  /** After anything that changes money: this month, goals and the trend. */
  private reloadMoney(): void { this.loadEntries(); this.loadGoals(); this.loadTrend(); }

  openGoal(goal: Goal | null, suggestion: Partial<GoalDraft> | null = null): void { this.goalSheet.set({ goal, suggestion }); }
  addToGoal(goal: Goal): void { this.sheetGoal.set(goal.id); this.sheet.set({ kind: 'SAVING', entry: null }); }
  onGoalSaved(event: { goal: Goal; created: boolean; hidden: boolean }): void {
    this.goalSheet.set(undefined);
    this.showToast({ message: event.hidden ? `${event.goal.name} hidden` : event.created ? `Goal created · ${event.goal.icon} ${event.goal.name}` : 'Goal updated' });
    this.loadGoals();
  }
  showGoalAgain(goal: Goal): void {
    const { name, icon, targetAmount, startingAmount, targetDate } = goal;
    this.service.updateGoal(goal.id, { name, icon, targetAmount, startingAmount, targetDate, archived: false }).subscribe({
      next: () => this.loadGoals(),
      error: (err) => this.showToast({ message: this.service.errorMessage(err, 'Could not show this goal.') }),
    });
  }
  goalDateLabel(iso: string): string { return parseIso(iso).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }); }
  /** Bar height in % of the plot; the tallest bar uses 80% so its label still fits above it. */
  trendHeight(rate: number | null): number { return rate && rate > 0 ? Math.max(2, (rate / this.trendMax()) * 80) : 0; }

  step(by: number): void { if (by > 0 && this.isCurrentMonth()) return; this.monthOffset.update((n) => n + by); this.loadEntries(); }
  goToCurrent(): void { this.monthOffset.set(0); this.loadEntries(); }

  openSheet(kind: EntryKind, entry: Entry | null = null): void { this.sheetGoal.set(null); this.sheet.set({ kind, entry }); }
  onQuickSaved(entry: Entry): void {
    this.quickOpen.set(false);
    // Quick expense always logs today; jump back to this month if an older one was on screen.
    if (!this.isCurrentMonth()) this.monthOffset.set(0);
    const c = this.categoryById().get(entry.categoryId);
    const after = (this.amounts().get(entry.categoryId) ?? 0) + entry.amount;
    const limit = c?.monthlyBudget ?? 0;
    const note = limit && after > limit ? ` · ₹${Math.round(after - limit).toLocaleString('en-IN')} over limit` : limit && after >= limit * 0.8 ? ` · ${Math.round((after / limit) * 100)}% of limit` : '';
    this.showToast({ message: `Spent ${this.rupees(entry.amount)} · ${c?.name ?? ''}${note}`, actionLabel: 'Undo', action: () => this.undoCreate(entry) });
    this.reloadMoney();
  }
  onCategoryChanged(saved: Category): void {
    this.categories.update((list) => list.some((c) => c.id === saved.id) ? list.map((c) => c.id === saved.id ? saved : c) : [...list, saved]);
    writeSnapshot({ categories: this.categories() });
  }
  pickDay(iso: string): void {
    this.dayFilter.set(this.dayFilter() === iso ? null : iso);
    if (this.dayFilter()) setTimeout(() => this.scrollTo('activity'));
  }
  barHeight(value: number): number { return value ? Math.max(3, (value / this.chartMax()) * 100) : 0; }
  /** First day, then every 5th date; days 1–2 are skipped so they don't run into 30. */
  showDayLabel(date: Date, index: number): boolean { return index === 0 || date.getDate() % 5 === 0; }
  onSaved(event: { entry: Entry; edited: boolean; addAnother: boolean }): void {
    if (!event.addAnother) this.sheet.set(undefined);
    const e = event.entry;
    const name = this.categoryById().get(e.categoryId)?.name ?? '';
    const amount = this.rupees(e.amount);
    const message = event.edited ? 'Entry updated'
      : e.kind === 'INCOME' ? `Added ${amount} income · ${name}`
      : e.kind === 'SAVING' ? `Saved ${amount} · ${name}`
      : e.kind === 'SAVING_WITHDRAWAL' ? `Took ${amount} out of ${name}`
      : `Spent ${amount} · ${name}`;
    const otherMonth = !contains(this.month(), parseIso(e.date));
    this.showToast(event.edited ? { message: otherMonth ? 'Entry moved to another month' : message }
      : { message: otherMonth ? `${message} — saved in another month` : message, actionLabel: 'Undo', action: () => this.undoCreate(e) });
    this.reloadMoney();
  }
  private undoCreate(entry: Entry): void {
    this.service.deleteEntry(entry.id).subscribe({
      next: () => { this.showToast({ message: 'Removed' }); this.reloadMoney(); },
      error: (err) => this.showToast({ message: this.service.errorMessage(err, 'Could not undo.') }),
    });
  }
  removeEntry(entry: Entry): void {
    this.entries.update((list) => list.filter((e) => e.id !== entry.id));
    this.service.deleteEntry(entry.id).subscribe({
      next: () => { this.showToast({ message: 'Entry deleted', actionLabel: 'Undo', action: () => this.restore(entry) }); this.loadGoals(); this.loadTrend(); },
      error: (err) => { this.showToast({ message: this.service.errorMessage(err, 'Could not delete this entry.') }); this.loadEntries(); },
    });
  }
  private restore(entry: Entry): void {
    const { id, ...draft } = entry;
    this.service.createEntry(draft).subscribe({
      next: () => { this.showToast({ message: 'Entry restored' }); this.reloadMoney(); },
      error: (err) => this.showToast({ message: this.service.errorMessage(err, 'Could not restore this entry.') }),
    });
  }

  // ── Row helpers ───────────────────────────────────────────
  bucketOf(e: Entry): Bucket { return entryBucket(e, this.categoryById()); }
  categoryOf(e: Entry): Category | undefined { return this.categoryById().get(e.categoryId); }
  entryTitle(e: Entry): string { return e.note || this.categoryOf(e)?.name || 'Entry'; }
  entrySubtitle(e: Entry): string {
    const bucket = { INCOME: 'Income', NEED: 'Need', WANT: 'Want', SAVING: e.kind === 'SAVING_WITHDRAWAL' ? 'Taken out of savings' : 'Saved' }[this.bucketOf(e)];
    const mode = PAYMENT_MODES.find((m) => m.key === e.paymentMode)?.label;
    return [e.note ? this.categoryOf(e)?.name : null, bucket, mode].filter(Boolean).join(' · ');
  }
  entrySign(e: Entry): string { return e.kind === 'INCOME' ? '+' : e.kind === 'EXPENSE' ? '−' : e.kind === 'SAVING_WITHDRAWAL' ? '←' : ''; }
  private rupees(n: number): string { return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
  abs(n: number): number { return Math.abs(n); }

  openSettings(): void {
    this.draft.set({ ...this.settings() });
    this.settingsError.set('');
    this.settingsOpen.set(true);
  }
  patchDraft(patch: Partial<BudgetSettings>): void { this.draft.update((d) => ({ ...d, ...patch })); }
  setPercent(key: keyof BudgetSettings, value: number | null): void { this.patchDraft({ [key]: value === null ? 0 : Math.round(+value) }); }

  /** Saves the key as it is typed or pasted, so closing Settings any way keeps it. */
  onKeyInput(value: string): void { this.apiKeyDraft.set(value); saveApiKey(value.trim()); }
  connect(): void {
    const key = this.apiKeyDraft().trim();
    this.apiKeyDraft.set(key);
    saveApiKey(key);
    if (key) this.refresh();
  }

  /** Shared settings go to the server only when something changed and the sheet is valid. */
  saveSettings(): void {
    const draft = this.draft();
    const unchanged = (Object.keys(draft) as (keyof BudgetSettings)[]).every((k) => draft[k] === this.settings()[k]);
    if (this.needsKey() || unchanged) { this.closeSettings(); return; }
    if (this.draftTotal() !== 100) { this.settingsError.set(`Needs, wants and savings add up to ${this.draftTotal()}%. Make it 100%.`); return; }
    this.savingSettings.set(true);
    this.settingsError.set('');
    this.service.saveSettings({ ...draft, name: (draft.name ?? '').trim() }).subscribe({
      next: (saved) => {
        this.savingSettings.set(false);
        const startChanged = saved.monthStartDay !== this.settings().monthStartDay;
        this.settings.set(saved);
        if (startChanged) {
          // Saved months were cut at the old start day; drop them rather than show wrong ranges.
          clearSnapshot(); this.cachedMonths = {};
          writeSnapshot({ settings: saved, categories: this.categories(), goals: this.goals() });
          this.monthOffset.set(0); this.loadEntries(); this.loadTrend();
        } else {
          writeSnapshot({ settings: saved });
        }
        this.closeSettings();
        this.showToast({ message: 'Settings saved on all your devices' });
      },
      error: (err) => { this.savingSettings.set(false); this.settingsError.set(this.service.errorMessage(err, 'Could not save settings. Try again.')); },
    });
  }
  /** Closing after entering a key retries the load, the same as tapping Connect. */
  closeSettings(): void {
    if (this.savingSettings()) return;
    this.settingsOpen.set(false);
    if (this.apiKeyDraft().trim() && (this.needsKey() || this.error())) this.refresh();
  }

  ordinal(n: number): string {
    const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
    return `${n}${suffix}`;
  }
  setTheme(theme: Theme): void { this.theme.set(theme); }
  toggleTheme(): void { this.theme.set(this.isDark() ? 'light' : 'dark'); }
  scrollTo(id: string): void { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  showToast(toast: Toast): void {
    clearTimeout(this.toastTimer);
    this.toast.set(toast);
    this.toastTimer = setTimeout(() => this.toast.set(null), toast.action ? 6000 : 3000);
  }
  runToastAction(): void { const action = this.toast()?.action; this.toast.set(null); action?.(); }

  private loadTheme(): Theme {
    try { const t = localStorage.getItem(THEME_KEY); return t === 'light' || t === 'dark' ? t : 'system'; } catch { return 'system'; }
  }
}
