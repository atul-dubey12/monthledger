import { Component, EventEmitter, HostListener, Input, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CurrencyPipe, NgTemplateOutlet } from '@angular/common';
import { LucideAngularModule, Check, Plus, X, Tags } from 'lucide-angular';
import { BudgetService } from './budget.service';
import { Bucket, BudgetSettings, Category } from './models';

interface Editing { id: number | null; bucket: Bucket; name: string; icon: string; limit: number | null; }

const SECTIONS: { bucket: Bucket; label: string; percentKey?: keyof BudgetSettings; hasLimit: boolean }[] = [
  { bucket: 'NEED', label: 'Needs', percentKey: 'needsPercent', hasLimit: true },
  { bucket: 'WANT', label: 'Wants', percentKey: 'wantsPercent', hasLimit: true },
  { bucket: 'SAVING', label: 'Savings', hasLimit: false },
  { bucket: 'INCOME', label: 'Income', hasLimit: false },
];

/** Add, rename, hide categories and set a monthly limit on each Need and Want. */
@Component({
  selector: 'app-categories-sheet',
  imports: [FormsModule, CurrencyPipe, NgTemplateOutlet, LucideAngularModule],
  template: `
<div class="modal-backdrop" (click)="closed.emit()">
  <section class="entry-modal categories-sheet" role="dialog" aria-modal="true" aria-labelledby="cat-title" (click)="$event.stopPropagation()">
    <div class="modal-head">
      <span class="modal-icon modal-income"><i-lucide [img]="icons.Tags"></i-lucide></span>
      <div><h2 id="cat-title">Categories & limits</h2><p class="modal-subtitle">Limits repeat every month · amber at 80%, red when over</p></div>
      <button type="button" class="icon-button modal-close" aria-label="Close" (click)="closed.emit()"><i-lucide [img]="icons.X"></i-lucide></button>
    </div>

    @for (s of sections(); track s.bucket) {
      <div class="cat-section">
        <div class="cat-section-head">
          <strong>{{ s.label }}</strong>
          @if (s.hasLimit && s.target) {
            <small [class.cat-over]="s.limits > s.target">Limits {{ s.limits | currency:'INR':'symbol':'1.0-0' }} of {{ s.target | currency:'INR':'symbol':'1.0-0' }} ({{ s.percent }}% of income)</small>
          } @else if (s.hasLimit && s.limits) {
            <small>Limits {{ s.limits | currency:'INR':'symbol':'1.0-0' }} a month</small>
          }
        </div>
        @if (s.hasLimit && s.target && s.limits > s.target) {
          <p class="warn-note">Your {{ s.label.toLowerCase() }} limits add up to {{ (s.limits - s.target) | currency:'INR':'symbol':'1.0-0' }} more than your {{ s.percent }}% plan.</p>
        }
        @for (c of s.categories; track c.id) {
          @if (editing()?.id === c.id) {
            <ng-container *ngTemplateOutlet="editor"></ng-container>
          } @else {
            <button type="button" class="cat-row" (click)="edit(c)">
              <span class="cat-row-icon" aria-hidden="true">{{ c.icon }}</span>
              <span class="cat-row-name">{{ c.name }}</span>
              @if (s.hasLimit) { <span class="cat-row-limit">{{ c.monthlyBudget ? (c.monthlyBudget | currency:'INR':'symbol':'1.0-0') + '/mo' : 'No limit' }}</span> }
            </button>
          }
        }
        @if (editing()?.id === null && editing()?.bucket === s.bucket) {
          <ng-container *ngTemplateOutlet="editor"></ng-container>
        } @else {
          <button type="button" class="text-button cat-add" (click)="add(s.bucket)"><i-lucide [img]="icons.Plus"></i-lucide> Add to {{ s.label }}</button>
        }
      </div>
    }

    @if (hidden().length) {
      <div class="cat-section">
        <div class="cat-section-head"><strong>Hidden</strong><small>Old entries keep these</small></div>
        @for (c of hidden(); track c.id) {
          <div class="cat-row cat-row-hidden">
            <span class="cat-row-icon" aria-hidden="true">{{ c.icon }}</span><span class="cat-row-name">{{ c.name }}</span>
            <button type="button" class="text-button" [disabled]="saving()" (click)="setHidden(c, false)">Show again</button>
          </div>
        }
      </div>
    }

    <ng-template #editor>
      @if (editing(); as e) {
        <div class="cat-editor">
          <div class="cat-editor-row">
            <input class="form-input cat-emoji-input" aria-label="Emoji" maxlength="8" [ngModel]="e.icon" (ngModelChange)="patch({ icon: $event })">
            <input class="form-input" aria-label="Category name" maxlength="40" placeholder="Name, e.g. Gym" [ngModel]="e.name" (ngModelChange)="patch({ name: $event })" (keydown.enter)="save()">
          </div>
          @if (e.bucket === 'NEED' || e.bucket === 'WANT') {
            <label class="field-label">Monthly limit <span>(empty = no limit)</span></label>
            <div class="amount-input cat-limit"><span>₹</span>
              <input type="number" inputmode="numeric" min="0" step="100" placeholder="No limit" aria-label="Monthly limit"
                     [ngModel]="e.limit" (ngModelChange)="patch({ limit: $event })" (keydown.enter)="save()">
            </div>
          }
          @if (error()) { <p class="form-error" role="alert">{{ error() }}</p> }
          <div class="cat-editor-actions">
            @if (e.id !== null) { <button type="button" class="text-button cat-hide" [disabled]="saving()" (click)="hideEditing()">Hide</button> }
            <button type="button" class="secondary-button" [disabled]="saving()" (click)="cancel()">Cancel</button>
            <button type="button" class="primary-button" [disabled]="saving()" (click)="save()">{{ saving() ? 'Saving…' : 'Save' }} <i-lucide [img]="icons.Check"></i-lucide></button>
          </div>
        </div>
      }
    </ng-template>

    <div class="modal-actions"><button class="primary-button" (click)="closed.emit()">Done <i-lucide [img]="icons.Check"></i-lucide></button></div>
  </section>
</div>`
})
export class CategoriesSheetComponent {
  @Input({ required: true }) set categories(list: Category[]) { this.all.set(list); }
  @Input({ required: true }) settings!: BudgetSettings;
  /** This month's income, to turn the % split into rupee targets. */
  @Input() income = 0;
  /** Emits each saved category so the page can update without a reload. */
  @Output() changed = new EventEmitter<Category>();
  @Output() closed = new EventEmitter<void>();

  readonly icons = { Check, Plus, X, Tags };
  private readonly service = inject(BudgetService);
  readonly all = signal<Category[]>([]);
  readonly editing = signal<Editing | null>(null);
  readonly saving = signal(false);
  readonly error = signal('');

  readonly sections = computed(() => SECTIONS.map((s) => {
    const categories = this.all().filter((c) => c.bucket === s.bucket && !c.archived);
    const percent = s.percentKey ? (this.settings[s.percentKey] as number) : 0;
    return {
      ...s, categories, percent,
      limits: categories.reduce((sum, c) => sum + (c.monthlyBudget ?? 0), 0),
      target: s.percentKey && this.income > 0 ? Math.round((this.income * percent) / 100) : 0,
    };
  }));
  readonly hidden = computed(() => this.all().filter((c) => c.archived));

  @HostListener('document:keydown.escape') onEscape(): void { if (this.editing()) this.cancel(); else this.closed.emit(); }

  edit(c: Category): void { this.error.set(''); this.editing.set({ id: c.id, bucket: c.bucket, name: c.name, icon: c.icon, limit: c.monthlyBudget }); }
  add(bucket: Bucket): void { this.error.set(''); this.editing.set({ id: null, bucket, name: '', icon: '', limit: null }); }
  cancel(): void { this.editing.set(null); this.error.set(''); }
  patch(p: Partial<Editing>): void { this.editing.update((e) => e ? { ...e, ...p } : e); }

  save(): void {
    const e = this.editing();
    if (!e || this.saving()) return;
    const name = (e.name ?? '').trim();
    if (!name) { this.error.set('Give the category a name.'); return; }
    const limit = e.limit === null || (e.limit as unknown) === '' ? null : Number(e.limit);
    if (limit !== null && (!(limit >= 0) || Math.abs(limit * 100 - Math.round(limit * 100)) > 1e-6)) { this.error.set('Enter a limit in rupees, or leave it empty.'); return; }
    const draft = { name, icon: (e.icon ?? '').trim() || '•', bucket: e.bucket, monthlyBudget: limit ? limit : null };
    this.saving.set(true);
    this.error.set('');
    const request = e.id === null ? this.service.createCategory(draft) : this.service.updateCategory(e.id, draft);
    request.subscribe({
      next: (saved) => { this.saving.set(false); this.editing.set(null); this.store(saved); },
      error: (err) => { this.saving.set(false); this.error.set(this.service.errorMessage(err, 'Could not save this category.')); },
    });
  }

  hideEditing(): void {
    const e = this.editing();
    const c = e?.id != null ? this.all().find((x) => x.id === e.id) : null;
    if (c) this.setHidden(c, true);
  }

  setHidden(c: Category, archived: boolean): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.service.updateCategory(c.id, { name: c.name, icon: c.icon, bucket: c.bucket, monthlyBudget: c.monthlyBudget, archived }).subscribe({
      next: (saved) => { this.saving.set(false); this.editing.set(null); this.store(saved); },
      error: (err) => { this.saving.set(false); this.error.set(this.service.errorMessage(err, 'Could not update this category.')); },
    });
  }

  private store(saved: Category): void {
    this.all.update((list) => list.some((c) => c.id === saved.id) ? list.map((c) => c.id === saved.id ? saved : c) : [...list, saved]);
    this.changed.emit(saved);
  }
}
