import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule, ArrowDownLeft, ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight, LayoutDashboard, Moon, PiggyBank,
  Settings2, ShieldCheck, Sun, Target, Timer, Wallet, X, CircleAlert, Receipt, Plus, Search, Trash2, Pencil, Undo2, Zap
} from 'lucide-angular';
import { NetworkStatus, readApiKey, saveApiKey } from './api.interceptor';
import { BudgetService } from './budget.service';
import { BUCKETS, Bucket, BudgetSettings, Category, Entry, EntryKind, PAYMENT_MODES } from './models';
import { budgetMonthFor, contains, daysLeft, isoDate, monthName, monthRange, shiftMonth, totalDays } from './month';
import { byDay, entryBucket, monthTotals, parseIso } from './ledger';
import { EntrySheetComponent } from './entry-sheet.component';

type Theme = 'system' | 'light' | 'dark';
interface Toast { message: string; actionLabel?: string; action?: () => void; }
type ActivityFilter = 'ALL' | 'INCOME' | 'NEED' | 'WANT' | 'SAVING';

const THEME_KEY = 'monthledger.theme';
const DEFAULT_SETTINGS: BudgetSettings = { name: '', needsPercent: 50, wantsPercent: 30, savingsPercent: 20, monthStartDay: 5 };

@Component({
  selector: 'app-root',
  imports: [FormsModule, CurrencyPipe, DatePipe, LucideAngularModule, EntrySheetComponent],
  templateUrl: './app.component.html'
})
export class AppComponent {
  readonly icons = {
    ArrowDownLeft, ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight, LayoutDashboard, Moon, PiggyBank, Settings2, ShieldCheck,
    Sun, Target, Timer, Wallet, X, CircleAlert, Receipt, Plus, Search, Trash2, Pencil, Undo2, Zap
  };
  readonly buckets = BUCKETS;
  private readonly service = inject(BudgetService);
  readonly slowNetwork = inject(NetworkStatus).slow;

  // ── Server data ───────────────────────────────────────────
  readonly settings = signal<BudgetSettings>(DEFAULT_SETTINGS);
  readonly categories = signal<Category[]>([]);
  readonly entries = signal<Entry[]>([]);
  /** Which budget month `entries` holds, so a slow response for another month is ignored. */
  private entriesFor = '';
  readonly entriesLoading = signal(false);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly needsKey = signal(false);

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
    return this.entries().filter((e) => {
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
    this.refresh();
    effect(() => {
      document.documentElement.dataset['theme'] = this.isDark() ? 'dark' : 'light';
      try { localStorage.setItem(THEME_KEY, this.theme()); } catch { /* storage blocked */ }
    });
  }

  refresh(): void {
    this.loading.set(true);
    this.service.settings().subscribe({
      next: (settings) => {
        this.settings.set(settings);
        this.service.categories().subscribe({
          next: (categories) => { this.categories.set(categories); this.loaded(); this.loadEntries(); },
          error: (err) => this.failed(err),
        });
      },
      error: (err) => this.failed(err),
    });
  }
  private loaded(): void { this.loading.set(false); this.error.set(''); this.needsKey.set(false); }
  private failed(err: unknown): void {
    this.loading.set(false);
    if (err instanceof HttpErrorResponse && err.status === 401) {
      this.error.set('');
      this.needsKey.set(true);
      this.openSettings();
      setTimeout(() => document.getElementById('server-key')?.focus());
      return;
    }
    this.error.set('Could not reach the server. Check your signal and tap Retry.');
  }

  loadEntries(): void {
    const month = this.month();
    const key = month.key;
    const last = new Date(month.end.getFullYear(), month.end.getMonth(), month.end.getDate() - 1);
    if (this.entriesFor !== key) this.entries.set([]);
    this.entriesFor = key;
    this.entriesLoading.set(true);
    this.service.entries(isoDate(month.start), isoDate(last)).subscribe({
      next: (entries) => { if (this.entriesFor !== key) return; this.entries.set(entries); this.entriesLoading.set(false); },
      error: (err) => { if (this.entriesFor !== key) return; this.entriesLoading.set(false); this.failed(err); },
    });
  }

  step(by: number): void { if (by > 0 && this.isCurrentMonth()) return; this.monthOffset.update((n) => n + by); this.loadEntries(); }
  goToCurrent(): void { this.monthOffset.set(0); this.loadEntries(); }

  openSheet(kind: EntryKind, entry: Entry | null = null): void { this.sheet.set({ kind, entry }); }
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
    this.loadEntries();
  }
  private undoCreate(entry: Entry): void {
    this.service.deleteEntry(entry.id).subscribe({
      next: () => { this.showToast({ message: 'Removed' }); this.loadEntries(); },
      error: (err) => this.showToast({ message: this.service.errorMessage(err, 'Could not undo.') }),
    });
  }
  removeEntry(entry: Entry): void {
    this.entries.update((list) => list.filter((e) => e.id !== entry.id));
    this.service.deleteEntry(entry.id).subscribe({
      next: () => this.showToast({ message: 'Entry deleted', actionLabel: 'Undo', action: () => this.restore(entry) }),
      error: (err) => { this.showToast({ message: this.service.errorMessage(err, 'Could not delete this entry.') }); this.loadEntries(); },
    });
  }
  private restore(entry: Entry): void {
    const { id, ...draft } = entry;
    this.service.createEntry(draft).subscribe({
      next: () => { this.showToast({ message: 'Entry restored' }); this.loadEntries(); },
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
        if (startChanged) { this.monthOffset.set(0); this.loadEntries(); }
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
