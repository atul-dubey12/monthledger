import { DialogFocusDirective } from './dialog-focus.directive';
import { Component, EventEmitter, HostListener, Input, Output, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Check, Plus, Repeat, X } from 'lucide-angular';
import { BudgetService } from './budget.service';
import { Category, Goal, KIND_BUCKETS, PAYMENT_MODES, PaymentMode, Recurring, RecurringDraft } from './models';

type Kind = Recurring['kind'];
interface Editing extends RecurringDraft { id: number | null; }

const KINDS: { key: Kind; label: string }[] = [
  { key: 'EXPENSE', label: 'Expense' }, { key: 'INCOME', label: 'Income' }, { key: 'SAVING', label: 'Saving' },
];

/** Add, edit or stop the things that happen every month. */
@Component({
  selector: 'app-recurring-sheet',
  imports: [DialogFocusDirective, FormsModule, CurrencyPipe, NgTemplateOutlet, LucideAngularModule],
  template: `
<div class="modal-backdrop" (click)="closed.emit()">
  <section class="entry-modal categories-sheet" appDialogFocus role="dialog" aria-modal="true" aria-labelledby="rec-title" (click)="$event.stopPropagation()">
    <div class="modal-head">
      <span class="modal-icon modal-income"><i-lucide [img]="icons.Repeat"></i-lucide></span>
      <div><h2 id="rec-title">Monthly items</h2><p class="modal-subtitle">They show in "Due this month" — nothing is added until you tap Paid</p></div>
      <button type="button" class="icon-button modal-close" aria-label="Close" (click)="closed.emit()"><i-lucide [img]="icons.X"></i-lucide></button>
    </div>

    @if (suggestions.length && !editing()) {
      <div class="cat-section">
        <div class="cat-section-head"><strong>Suggested from your entries</strong><small>One tap to add</small></div>
        @for (s of suggestions; track $index) {
          <div class="cat-row rec-suggest">
            <span class="cat-row-icon" aria-hidden="true">{{ categoryOf(s.categoryId)?.icon }}</span>
            <span class="cat-row-name">{{ s.name }}<small>{{ s.amount | currency:'INR':'symbol':'1.0-0' }} · {{ kindLabel(s.kind) }} · every {{ ordinal(s.dayOfMonth) }}</small></span>
            <button type="button" class="secondary-button" [disabled]="saving()" (click)="addSuggestion(s)"><i-lucide [img]="icons.Plus"></i-lucide> Add</button>
          </div>
        }
      </div>
    }

    <div class="cat-section">
      <div class="cat-section-head"><strong>Every month</strong>@if (items.length) { <small>{{ items.length }} {{ items.length === 1 ? 'item' : 'items' }}</small> }</div>
      @for (r of items; track r.id) {
        @if (editing()?.id === r.id) { <ng-container *ngTemplateOutlet="editor"></ng-container> }
        @else {
          <button type="button" class="cat-row" (click)="edit(r)">
            <span class="cat-row-icon" aria-hidden="true">{{ categoryOf(r.categoryId)?.icon }}</span>
            <span class="cat-row-name">{{ r.name }}<small>{{ kindLabel(r.kind) }} · every {{ ordinal(r.dayOfMonth) }}</small></span>
            <span class="cat-row-limit">{{ r.amount | currency:'INR':'symbol':'1.0-0' }}</span>
          </button>
        }
      } @empty {
        @if (!editing()) { <p class="muted-empty">Nothing yet. Add your salary, home money, SIP, recharge or gym fee.</p> }
      }
      <!-- In templates editing()?.id is null (not undefined) when nothing is open, so check editing() first. -->
      @if (editing() && editing()!.id === null) { <ng-container *ngTemplateOutlet="editor"></ng-container> }
      @else if (!editing()) { <button type="button" class="text-button cat-add" (click)="add()"><i-lucide [img]="icons.Plus"></i-lucide> Add monthly item</button> }
    </div>

    <ng-template #editor>
      @if (editing(); as e) {
        <div class="cat-editor">
          <div class="segmented segmented-full" role="tablist" aria-label="Kind">
            @for (k of kinds; track k.key) {
              <button type="button" role="tab" [attr.aria-selected]="e.kind === k.key" [class.selected]="e.kind === k.key" (click)="setKind(k.key)">{{ k.label }}</button>
            }
          </div>
          <label class="field-label" for="rec-name">Name</label>
          <input class="form-input" id="rec-name" maxlength="40" placeholder="e.g. Gym fee, Mobile recharge" [ngModel]="e.name" (ngModelChange)="patch({ name: $event })">
          <div class="rec-row">
            <label class="rec-cell"><span class="field-label">Amount</span>
              <span class="amount-input cat-limit"><span>₹</span><input type="number" inputmode="decimal" min="0" placeholder="0" aria-label="Amount" [ngModel]="e.amount" (ngModelChange)="patch({ amount: $event })"></span>
            </label>
            <label class="rec-cell rec-day"><span class="field-label">Day</span>
              <input class="form-input" type="number" inputmode="numeric" min="1" max="31" aria-label="Day of month" [ngModel]="e.dayOfMonth" (ngModelChange)="patch({ dayOfMonth: $event })">
            </label>
          </div>
          <span class="field-label">Category</span>
          <div class="chip-row chip-row-tight">
            @for (c of categoryOptions(); track c.id) {
              <button type="button" class="chip" [class.selected]="e.categoryId === c.id" (click)="patch({ categoryId: c.id })">{{ c.icon }} {{ c.name }}</button>
            }
          </div>
          @if (e.kind === 'SAVING' && activeGoals().length) {
            <span class="field-label">Towards goal <span>(optional)</span></span>
            <div class="chip-row chip-row-tight">
              <button type="button" class="chip" [class.selected]="e.goalId === null" (click)="patch({ goalId: null })">No goal</button>
              @for (g of activeGoals(); track g.id) { <button type="button" class="chip chip-goal" [class.selected]="e.goalId === g.id" (click)="patch({ goalId: g.id })">{{ g.icon }} {{ g.name }}</button> }
            </div>
          }
          <span class="field-label">{{ e.kind === 'INCOME' ? 'Received by' : 'Paid by' }}</span>
          <div class="chip-row chip-row-tight">
            @for (m of modes; track m.key) { <button type="button" class="chip" [class.selected]="e.paymentMode === m.key" (click)="patch({ paymentMode: m.key })">{{ m.label }}</button> }
          </div>
          @if (error()) { <p class="form-error" role="alert">{{ error() }}</p> }
          <div class="cat-editor-actions">
            @if (e.id !== null) { <button type="button" class="text-button cat-hide" [disabled]="saving()" (click)="stop()">Stop this</button> }
            <button type="button" class="secondary-button" [disabled]="saving()" (click)="editing.set(null)">Cancel</button>
            <button type="button" class="primary-button" [disabled]="saving()" (click)="save()">{{ saving() ? 'Saving…' : 'Save' }} <i-lucide [img]="icons.Check"></i-lucide></button>
          </div>
        </div>
      }
    </ng-template>

    <div class="modal-actions"><button class="primary-button" (click)="closed.emit()">Done <i-lucide [img]="icons.Check"></i-lucide></button></div>
  </section>
</div>`
})
export class RecurringSheetComponent {
  @Input({ required: true }) items: Recurring[] = [];
  @Input({ required: true }) categories: Category[] = [];
  @Input() goals: Goal[] = [];
  @Input() suggestions: RecurringDraft[] = [];
  /** Emits after any save so the page reloads the list. */
  @Output() changed = new EventEmitter<string>();
  @Output() closed = new EventEmitter<void>();

  readonly icons = { Check, Plus, Repeat, X };
  readonly kinds = KINDS;
  readonly modes = PAYMENT_MODES;
  private readonly service = inject(BudgetService);
  readonly editing = signal<Editing | null>(null);
  readonly saving = signal(false);
  readonly error = signal('');

  readonly activeGoals = computed(() => this.goals.filter((g) => !g.archived));
  readonly categoryOptions = computed(() => {
    const e = this.editing();
    return e ? this.categories.filter((c) => !c.archived && KIND_BUCKETS[e.kind].includes(c.bucket)) : [];
  });

  @HostListener('document:keydown.escape') onEscape(): void { if (this.editing()) this.editing.set(null); else this.closed.emit(); }

  categoryOf(id: number): Category | undefined { return this.categories.find((c) => c.id === id); }
  kindLabel(kind: Kind): string { return kind === 'INCOME' ? 'Income' : kind === 'SAVING' ? 'Saving' : 'Expense'; }
  ordinal(n: number): string { return `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`; }

  add(): void {
    this.error.set('');
    this.editing.set({ id: null, name: '', kind: 'EXPENSE', amount: null as unknown as number, categoryId: this.firstCategory('EXPENSE'), goalId: null, dayOfMonth: 5, paymentMode: 'UPI' });
  }
  edit(r: Recurring): void {
    this.error.set('');
    this.editing.set({ id: r.id, name: r.name, kind: r.kind, amount: r.amount, categoryId: r.categoryId, goalId: r.goalId, dayOfMonth: r.dayOfMonth, paymentMode: r.paymentMode });
  }
  patch(p: Partial<Editing>): void { this.editing.update((e) => e ? { ...e, ...p } : e); }
  setKind(kind: Kind): void {
    const e = this.editing();
    if (!e || e.kind === kind) return;
    this.patch({ kind, categoryId: this.firstCategory(kind), goalId: null, paymentMode: (kind === 'EXPENSE' ? 'UPI' : 'BANK') as PaymentMode });
  }
  private firstCategory(kind: Kind): number {
    return this.categories.find((c) => !c.archived && KIND_BUCKETS[kind].includes(c.bucket))?.id ?? 0;
  }

  addSuggestion(s: RecurringDraft): void { this.send(null, s); }

  save(): void {
    const e = this.editing();
    if (!e) return;
    const name = (e.name ?? '').trim();
    const amount = Number(e.amount);
    const day = Number(e.dayOfMonth);
    if (!name) { this.error.set('Give it a name, e.g. Gym fee.'); return; }
    if (!(amount > 0)) { this.error.set('Enter an amount greater than ₹0.'); return; }
    if (!Number.isInteger(day) || day < 1 || day > 31) { this.error.set('Pick a day between 1 and 31.'); return; }
    if (!e.categoryId) { this.error.set('Pick a category.'); return; }
    const { id, ...draft } = e;
    this.send(id, { ...draft, name, amount, dayOfMonth: day });
  }

  stop(): void {
    const e = this.editing();
    if (!e || e.id === null) return;
    const { id, ...draft } = e;
    this.send(id, { ...draft, active: false });
  }

  private send(id: number | null, draft: RecurringDraft): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    const request = id === null ? this.service.createRecurring(draft) : this.service.updateRecurring(id, draft);
    request.subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.editing.set(null);
        this.changed.emit(draft.active === false ? `Stopped ${saved.name}` : id === null ? `Added ${saved.name} · every ${this.ordinal(saved.dayOfMonth)}` : `${saved.name} updated`);
      },
      error: (err) => { this.saving.set(false); this.error.set(this.service.errorMessage(err, 'Could not save this item.')); },
    });
  }
}
