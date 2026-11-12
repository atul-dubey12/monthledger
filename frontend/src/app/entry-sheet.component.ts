import { Component, EventEmitter, HostListener, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, ArrowDownLeft, ArrowUpRight, Check, PiggyBank, Plus, X } from 'lucide-angular';
import { BudgetService } from './budget.service';
import { Category, Entry, EntryDraft, EntryKind, KIND_BUCKETS, PAYMENT_MODES, PaymentMode } from './models';
import { isoDate } from './month';

/** The three tabs at the top of the sheet. A withdrawal is the Saving tab with "Taking money out" switched on. */
type Tab = 'EXPENSE' | 'INCOME' | 'SAVING';
const LAST_CATEGORY_KEY = 'monthledger.lastCategory';
const LAST_MODE_KEY = 'monthledger.lastPaymentMode';

@Component({
  selector: 'app-entry-sheet',
  imports: [FormsModule, LucideAngularModule],
  template: `
<div class="modal-backdrop" (click)="closed.emit()">
  <section class="entry-modal" role="dialog" aria-modal="true" aria-labelledby="entry-title" (click)="$event.stopPropagation()">
    <div class="modal-head">
      <span class="modal-icon" [attr.data-tab]="tab()">
        <i-lucide [img]="tab() === 'INCOME' ? icons.ArrowDownLeft : tab() === 'SAVING' ? icons.PiggyBank : icons.ArrowUpRight"></i-lucide>
      </span>
      <div>
        <h2 id="entry-title">{{ entry ? 'Edit entry' : 'Add ' + tabLabel() }}</h2>
        <p class="modal-subtitle">{{ subtitle() }}</p>
      </div>
      <button type="button" class="icon-button modal-close" aria-label="Close" (click)="closed.emit()"><i-lucide [img]="icons.X"></i-lucide></button>
    </div>

    <form (ngSubmit)="submit(false)">
      <div class="segmented segmented-full kind-tabs" role="tablist" aria-label="Kind of entry">
        <button type="button" role="tab" [attr.aria-selected]="tab() === 'EXPENSE'" [class.selected]="tab() === 'EXPENSE'" (click)="setTab('EXPENSE')">Expense</button>
        <button type="button" role="tab" [attr.aria-selected]="tab() === 'INCOME'" [class.selected]="tab() === 'INCOME'" (click)="setTab('INCOME')">Income</button>
        <button type="button" role="tab" [attr.aria-selected]="tab() === 'SAVING'" [class.selected]="tab() === 'SAVING'" (click)="setTab('SAVING')">Saving</button>
      </div>

      <label class="field-label" for="amount">Amount</label>
      <div class="amount-input">
        <span>₹</span>
        <input id="amount" name="amount" type="number" inputmode="decimal" min="0" step="any" placeholder="0" [(ngModel)]="amount" required autofocus>
      </div>

      @for (group of groups(); track group.label) {
        <span class="field-label">{{ group.label }}</span>
        <div class="category-picker" role="radiogroup" [attr.aria-label]="group.label">
          @for (c of group.categories; track c.id) {
            <button type="button" role="radio" [attr.aria-checked]="categoryId() === c.id" [class.selected]="categoryId() === c.id"
                    [attr.data-bucket]="c.bucket" (click)="categoryId.set(c.id)">
              <span class="cat-emoji">{{ c.icon }}</span>{{ c.name }}
            </button>
          }
        </div>
      }

      @if (tab() === 'SAVING') {
        <button type="button" class="cod-toggle withdraw-toggle" [class.on]="withdrawal()" (click)="withdrawal.set(!withdrawal())" [attr.aria-pressed]="withdrawal()">
          <span><strong>Taking money out</strong><small>Turn on when you use savings, so "Saved" stays honest</small></span>
          <span class="switch"><span></span></span>
        </button>
      }

      <span class="field-label">{{ tab() === 'INCOME' ? 'Received by' : 'Paid by' }}</span>
      <div class="chip-row chip-row-tight">
        @for (m of modes; track m.key) {
          <button type="button" class="chip" [class.selected]="paymentMode() === m.key" (click)="paymentMode.set(m.key)">{{ m.label }}</button>
        }
      </div>

      <span class="field-label">Date</span>
      <div class="date-row">
        <button type="button" class="chip" [class.selected]="date === today" (click)="date = today">Today</button>
        <button type="button" class="chip" [class.selected]="date === yesterday" (click)="date = yesterday">Yesterday</button>
        <input class="form-input" aria-label="Date" name="date" type="date" [(ngModel)]="date" required>
      </div>

      <label class="field-label" for="note">Note <span>(optional)</span></label>
      <input class="form-input" id="note" name="note" type="text" maxlength="180" [placeholder]="placeholder()" [(ngModel)]="note">

      @if (error()) { <p class="form-error" role="alert">{{ error() }}</p> }

      <div class="modal-actions">
        @if (!entry) {
          <button type="button" class="secondary-button" [disabled]="saving()" (click)="submit(true)"><i-lucide [img]="icons.Plus"></i-lucide> Save & add another</button>
        }
        <button class="primary-button" type="submit" [attr.data-tab]="tab()" [disabled]="saving()">
          {{ saving() ? 'Saving…' : entry ? 'Save changes' : 'Save' }} <i-lucide [img]="icons.Check"></i-lucide>
        </button>
      </div>
    </form>
  </section>
</div>`
})
export class EntrySheetComponent implements OnInit {
  @Input() kind: EntryKind = 'EXPENSE';
  @Input() entry: Entry | null = null;
  @Input({ required: true }) categories: Category[] = [];
  /** Date to suggest for a new entry: today, or a day inside the month being viewed. */
  @Input() defaultDate = isoDate(new Date());
  @Output() saved = new EventEmitter<{ entry: Entry; edited: boolean; addAnother: boolean }>();
  @Output() closed = new EventEmitter<void>();

  readonly icons = { ArrowDownLeft, ArrowUpRight, Check, PiggyBank, Plus, X };
  readonly modes = PAYMENT_MODES;
  private readonly service = inject(BudgetService);

  readonly tab = signal<Tab>('EXPENSE');
  readonly withdrawal = signal(false);
  readonly categoryId = signal<number | null>(null);
  readonly paymentMode = signal<PaymentMode>('UPI');
  readonly saving = signal(false);
  readonly error = signal('');
  readonly today = isoDate(new Date());
  readonly yesterday = isoDate(new Date(Date.now() - 86_400_000));
  amount: number | null = null;
  date = this.today;
  note = '';

  readonly kindNow = computed<EntryKind>(() => this.tab() === 'SAVING' ? (this.withdrawal() ? 'SAVING_WITHDRAWAL' : 'SAVING') : this.tab());
  readonly tabLabel = computed(() => ({ EXPENSE: 'expense', INCOME: 'income', SAVING: this.withdrawal() ? 'withdrawal' : 'saving' })[this.tab()]);
  readonly subtitle = computed(() => ({
    EXPENSE: 'Where did the money go?',
    INCOME: 'Salary or anything else that came in',
    SAVING: this.withdrawal() ? 'Money you took back out of savings' : 'Money you put aside — pay yourself first',
  })[this.tab()]);
  readonly placeholder = computed(() => ({ EXPENSE: 'e.g. Big Bazaar weekly shop', INCOME: 'e.g. November salary', SAVING: 'e.g. Monthly SIP' })[this.tab()]);

  /** Expense shows Needs and Wants as two labelled groups; the others show one. */
  readonly groups = computed(() => {
    const usable = (bucket: string) => this.categories.filter((c) => c.bucket === bucket && (!c.archived || c.id === this.entry?.categoryId));
    if (this.tab() === 'EXPENSE') return [{ label: 'Needs', categories: usable('NEED') }, { label: 'Wants', categories: usable('WANT') }];
    return [{ label: 'Category', categories: usable(this.tab() === 'INCOME' ? 'INCOME' : 'SAVING') }];
  });

  ngOnInit(): void {
    if (this.entry) {
      const e = this.entry;
      this.tab.set(e.kind === 'SAVING_WITHDRAWAL' ? 'SAVING' : e.kind);
      this.withdrawal.set(e.kind === 'SAVING_WITHDRAWAL');
      this.amount = e.amount;
      this.date = e.date;
      this.note = e.note ?? '';
      this.categoryId.set(e.categoryId);
      this.paymentMode.set(e.paymentMode ?? 'UPI');
      return;
    }
    this.date = this.defaultDate;
    this.tab.set(this.kind === 'SAVING_WITHDRAWAL' ? 'SAVING' : this.kind);
    this.withdrawal.set(this.kind === 'SAVING_WITHDRAWAL');
    this.pickDefaults();
  }

  @HostListener('document:keydown.escape') onEscape(): void { this.closed.emit(); }

  setTab(tab: Tab): void {
    if (tab === this.tab()) return;
    this.tab.set(tab);
    this.withdrawal.set(false);
    this.error.set('');
    this.pickDefaults();
  }

  /** Last category and payment mode used for this tab, so a repeat entry is amount + Save. */
  private pickDefaults(): void {
    const remembered = this.remembered<number>(LAST_CATEGORY_KEY);
    const options = this.groups().flatMap((g) => g.categories);
    const last = options.find((c) => c.id === remembered[this.tab()]);
    this.categoryId.set(last?.id ?? options[0]?.id ?? null);
    const mode = this.remembered<PaymentMode>(LAST_MODE_KEY)[this.tab()];
    this.paymentMode.set(mode ?? (this.tab() === 'EXPENSE' ? 'UPI' : 'BANK'));
  }

  submit(addAnother: boolean): void {
    if (this.saving()) return;
    if (this.amount == null || !(this.amount > 0)) { this.error.set('Enter an amount greater than ₹0.'); return; }
    if (Math.abs(this.amount * 100 - Math.round(this.amount * 100)) > 1e-6) { this.error.set('Amounts can have at most 2 decimal places (paise).'); return; }
    const categoryId = this.categoryId();
    if (!categoryId || !KIND_BUCKETS[this.kindNow()].includes(this.categories.find((c) => c.id === categoryId)?.bucket ?? 'INCOME')) {
      this.error.set('Pick a category.'); return;
    }
    if (!this.date) { this.error.set('Pick a date.'); return; }
    const draft: EntryDraft = {
      date: this.date, kind: this.kindNow(), amount: this.amount, categoryId, paymentMode: this.paymentMode(), note: this.note.trim() || null,
    };
    this.saving.set(true);
    this.error.set('');
    const request = this.entry ? this.service.updateEntry(this.entry.id, draft) : this.service.createEntry(draft);
    request.subscribe({
      next: (entry) => {
        this.saving.set(false);
        this.remember(LAST_CATEGORY_KEY, categoryId);
        this.remember(LAST_MODE_KEY, this.paymentMode());
        this.saved.emit({ entry, edited: !!this.entry, addAnother });
        if (addAnother) { this.amount = null; this.note = ''; document.getElementById('amount')?.focus(); }
      },
      error: (err) => { this.saving.set(false); this.error.set(this.service.errorMessage(err, 'Could not save this entry. Try again.')); },
    });
  }

  private remembered<T>(key: string): Partial<Record<Tab, T>> {
    try { return JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { return {}; }
  }
  private remember(key: string, value: unknown): void {
    try { localStorage.setItem(key, JSON.stringify({ ...this.remembered(key), [this.tab()]: value })); } catch { /* storage blocked */ }
  }
}
