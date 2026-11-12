import { CurrencyPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule, ArrowDownLeft, ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight, LayoutDashboard, Moon, PiggyBank,
  Settings2, ShieldCheck, Sun, Target, Timer, Wallet, X, CircleAlert, Receipt
} from 'lucide-angular';
import { NetworkStatus, readApiKey, saveApiKey } from './api.interceptor';
import { BudgetService } from './budget.service';
import { BUCKETS, BudgetSettings, Category } from './models';
import { budgetMonthFor, contains, daysLeft, monthName, monthRange, shiftMonth, totalDays } from './month';

type Theme = 'system' | 'light' | 'dark';
interface Toast { message: string; }

const THEME_KEY = 'monthledger.theme';
const DEFAULT_SETTINGS: BudgetSettings = { name: '', needsPercent: 50, wantsPercent: 30, savingsPercent: 20, monthStartDay: 5 };

@Component({
  selector: 'app-root',
  imports: [FormsModule, CurrencyPipe, LucideAngularModule],
  templateUrl: './app.component.html'
})
export class AppComponent {
  readonly icons = {
    ArrowDownLeft, ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight, LayoutDashboard, Moon, PiggyBank, Settings2, ShieldCheck,
    Sun, Target, Timer, Wallet, X, CircleAlert, Receipt
  };
  readonly buckets = BUCKETS;
  private readonly service = inject(BudgetService);
  readonly slowNetwork = inject(NetworkStatus).slow;

  // ── Server data ───────────────────────────────────────────
  readonly settings = signal<BudgetSettings>(DEFAULT_SETTINGS);
  readonly categories = signal<Category[]>([]);
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

  // ── Plan ──────────────────────────────────────────────────
  readonly activeCategories = computed(() => this.categories().filter((c) => !c.archived));
  readonly incomeCategories = computed(() => this.activeCategories().filter((c) => c.bucket === 'INCOME'));
  readonly plan = computed(() => BUCKETS.map((b) => {
    const categories = this.activeCategories().filter((c) => c.bucket === b.key);
    const budgeted = categories.reduce((sum, c) => sum + (c.monthlyBudget ?? 0), 0);
    return { ...b, percent: this.settings()[b.percentKey] as number, categories, budgeted };
  }));

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
          next: (categories) => { this.categories.set(categories); this.loaded(); },
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

  step(by: number): void { if (by > 0 && this.isCurrentMonth()) return; this.monthOffset.update((n) => n + by); }
  goToCurrent(): void { this.monthOffset.set(0); }

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
        if (startChanged) this.monthOffset.set(0);
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
    this.toastTimer = setTimeout(() => this.toast.set(null), 3000);
  }

  private loadTheme(): Theme {
    try { const t = localStorage.getItem(THEME_KEY); return t === 'light' || t === 'dark' ? t : 'system'; } catch { return 'system'; }
  }
}
