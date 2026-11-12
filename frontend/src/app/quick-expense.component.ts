import { Component, EventEmitter, HostListener, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Check, X, Zap } from 'lucide-angular';
import { BudgetService } from './budget.service';
import { Category, Entry, PAYMENT_MODES, PaymentMode } from './models';
import { isoDate } from './month';

const LAST_CATEGORY_KEY = 'monthledger.quickCategory';
const LAST_MODE_KEY = 'monthledger.quickPaymentMode';
const USUAL_COUNT = 6;
const DEFAULT_AMOUNTS = [50, 100, 200, 500];

/** Two-tap logging of an everyday expense, today: amount, category, Save. */
@Component({
  selector: 'app-quick-expense',
  imports: [FormsModule, LucideAngularModule],
  template: `
<div class="modal-backdrop" (click)="closed.emit()">
  <section class="entry-modal quick-sheet" role="dialog" aria-modal="true" aria-labelledby="qe-title" (click)="$event.stopPropagation()">
    <div class="modal-head">
      <span class="modal-icon" data-tab="EXPENSE"><i-lucide [img]="icons.Zap"></i-lucide></span>
      <div><h2 id="qe-title">Quick expense</h2><p class="modal-subtitle">Today · amount, category, done</p></div>
      <button type="button" class="icon-button modal-close" aria-label="Close" (click)="closed.emit()"><i-lucide [img]="icons.X"></i-lucide></button>
    </div>

    <div class="amount-input">
      <span>₹</span>
      <input id="quick-amount" type="number" inputmode="decimal" min="0" step="any" placeholder="0" aria-label="Amount"
             [ngModel]="amount()" (ngModelChange)="amount.set($event)" (keydown.enter)="save()" autofocus>
    </div>
    <div class="chip-row">
      @for (value of amounts(); track value) {
        <button type="button" class="chip" [class.selected]="amount() === value" (click)="amount.set(value)">₹{{ value }}</button>
      }
    </div>

    <span class="field-label">{{ showAll() ? 'All categories' : 'Your usual' }}</span>
    <div class="chip-row chip-row-tight chip-row-big quick-cats" role="radiogroup" aria-label="Category">
      @for (c of shown(); track c.id) {
        <button type="button" role="radio" class="chip" [attr.data-bucket]="c.bucket" [attr.aria-checked]="categoryId() === c.id"
                [class.selected]="categoryId() === c.id" (click)="categoryId.set(c.id)"><span aria-hidden="true">{{ c.icon }}</span> {{ c.name }}</button>
      }
      <button type="button" class="chip chip-more" (click)="showAll.set(!showAll())">{{ showAll() ? 'Fewer' : 'More…' }}</button>
    </div>

    @if (budgetLine(); as line) {
      <p class="quick-budget" [attr.data-level]="line.level">{{ line.text }}</p>
    }

    <span class="field-label">Paid by</span>
    <div class="chip-row chip-row-tight">
      @for (m of modes; track m.key) {
        <button type="button" class="chip" [class.selected]="paymentMode() === m.key" (click)="paymentMode.set(m.key)">{{ m.label }}</button>
      }
    </div>

    @if (error()) { <p class="form-error" role="alert">{{ error() }}</p> }
    <div class="modal-actions">
      <button type="button" class="primary-button big-save" data-tab="EXPENSE" [disabled]="saving()" (click)="save()">
        {{ saving() ? 'Saving…' : summary() }} <i-lucide [img]="icons.Check"></i-lucide>
      </button>
    </div>
  </section>
</div>`
})
export class QuickExpenseComponent implements OnInit {
  @Input({ required: true }) categories: Category[] = [];
  /** Recent entries (this and last month), to rank "usual" categories and suggest amounts. */
  @Input() history: Entry[] = [];
  /** This month's amount per category, for the "₹X of ₹Y used" line. */
  @Input() spent = new Map<number, number>();
  @Output() saved = new EventEmitter<Entry>();
  @Output() closed = new EventEmitter<void>();

  readonly icons = { Check, X, Zap };
  readonly modes = PAYMENT_MODES;
  private readonly service = inject(BudgetService);
  readonly amount = signal<number | null>(null);
  readonly categoryId = signal<number | null>(null);
  readonly paymentMode = signal<PaymentMode>('UPI');
  readonly showAll = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');

  private readonly expenseCategories = computed(() => this.categories.filter((c) => !c.archived && (c.bucket === 'NEED' || c.bucket === 'WANT')));
  /** Most-used expense categories first; untouched ones keep their normal order after them. */
  private readonly ranked = computed(() => {
    const uses = new Map<number, number>();
    for (const e of this.history) if (e.kind === 'EXPENSE') uses.set(e.categoryId, (uses.get(e.categoryId) ?? 0) + 1);
    return [...this.expenseCategories()].sort((a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0));
  });
  readonly shown = computed(() => {
    if (this.showAll()) return this.expenseCategories();
    const usual = this.ranked().slice(0, USUAL_COUNT);
    const picked = this.expenseCategories().find((c) => c.id === this.categoryId());
    return picked && !usual.includes(picked) ? [...usual, picked] : usual;
  });
  readonly category = computed(() => this.expenseCategories().find((c) => c.id === this.categoryId()) ?? null);

  /** The amounts used most often for this category, falling back to round numbers. */
  readonly amounts = computed(() => {
    const counts = new Map<number, number>();
    for (const e of this.history) if (e.kind === 'EXPENSE' && e.categoryId === this.categoryId()) counts.set(e.amount, (counts.get(e.amount) ?? 0) + 1);
    const common = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([v]) => v).slice(0, 4);
    return common.length ? common.sort((a, b) => a - b) : DEFAULT_AMOUNTS;
  });

  readonly budgetLine = computed(() => {
    const c = this.category();
    if (!c?.monthlyBudget) return null;
    const used = this.spent.get(c.id) ?? 0;
    const after = used + (Number(this.amount()) || 0);
    const rupees = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
    if (after > c.monthlyBudget) return { level: 'over', text: `${c.name}: this takes you ${rupees(after - c.monthlyBudget)} over your ${rupees(c.monthlyBudget)} limit.` };
    const level = after >= c.monthlyBudget * 0.8 ? 'warn' : 'ok';
    return { level, text: `${c.name}: ${rupees(used)} of ${rupees(c.monthlyBudget)} used · ${rupees(c.monthlyBudget - after)} left after this` };
  });

  readonly summary = computed(() => {
    const amount = Number(this.amount()) || 0;
    const c = this.category();
    if (!amount) return 'Enter an amount';
    return `Save ₹${amount.toLocaleString('en-IN')}${c ? ' · ' + c.name : ''}`;
  });

  ngOnInit(): void {
    const last = Number(this.read(LAST_CATEGORY_KEY));
    const usable = this.expenseCategories();
    this.categoryId.set(usable.find((c) => c.id === last)?.id ?? this.ranked()[0]?.id ?? null);
    const mode = this.read(LAST_MODE_KEY) as PaymentMode | null;
    if (mode && this.modes.some((m) => m.key === mode)) this.paymentMode.set(mode);
  }

  @HostListener('document:keydown.escape') onEscape(): void { this.closed.emit(); }

  save(): void {
    if (this.saving()) return;
    const amount = Number(this.amount());
    if (!(amount > 0)) { this.error.set('Enter an amount greater than ₹0.'); return; }
    if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) { this.error.set('Amounts can have at most 2 decimal places (paise).'); return; }
    const categoryId = this.categoryId();
    if (!categoryId) { this.error.set('Pick a category.'); return; }
    this.saving.set(true);
    this.error.set('');
    this.service.createEntry({ date: isoDate(new Date()), kind: 'EXPENSE', amount, categoryId, paymentMode: this.paymentMode(), note: null }).subscribe({
      next: (entry) => {
        this.saving.set(false);
        this.write(LAST_CATEGORY_KEY, String(categoryId));
        this.write(LAST_MODE_KEY, this.paymentMode());
        this.saved.emit(entry);
      },
      error: (err) => { this.saving.set(false); this.error.set(this.service.errorMessage(err, 'Could not save. Try again.')); },
    });
  }

  private read(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
  private write(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } }
}
