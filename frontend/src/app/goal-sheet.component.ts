import { Component, EventEmitter, HostListener, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Check, Target, X } from 'lucide-angular';
import { BudgetService } from './budget.service';
import { Goal, GoalDraft } from './models';
import { goalPlan, parseIso } from './ledger';
import { budgetMonthFor, isoDate, monthsBetween } from './month';

/** Create or edit one savings goal, with a live "₹X a month" preview. */
@Component({
  selector: 'app-goal-sheet',
  imports: [FormsModule, LucideAngularModule],
  template: `
<div class="modal-backdrop" (click)="closed.emit()">
  <section class="entry-modal" role="dialog" aria-modal="true" aria-labelledby="goal-title" (click)="$event.stopPropagation()">
    <div class="modal-head">
      <span class="modal-icon" data-tab="SAVING"><i-lucide [img]="icons.Target"></i-lucide></span>
      <div><h2 id="goal-title">{{ goal ? 'Edit goal' : 'New savings goal' }}</h2><p class="modal-subtitle">Something worth saving for</p></div>
      <button type="button" class="icon-button modal-close" aria-label="Close" (click)="closed.emit()"><i-lucide [img]="icons.X"></i-lucide></button>
    </div>

    <form (ngSubmit)="save()">
      <label class="field-label" for="goal-name">Name</label>
      <div class="cat-editor-row">
        <input class="form-input cat-emoji-input" name="icon" aria-label="Emoji" maxlength="8" [(ngModel)]="icon">
        <input class="form-input" id="goal-name" name="name" maxlength="40" placeholder="e.g. Emergency fund, New bike" [(ngModel)]="name" required>
      </div>

      <label class="field-label" for="goal-target">Target</label>
      <div class="amount-input"><span>₹</span>
        <input id="goal-target" name="target" type="number" inputmode="numeric" min="0" step="1000" placeholder="e.g. 100000" [ngModel]="target()" (ngModelChange)="target.set($event)" required>
      </div>

      <label class="field-label" for="goal-start">Already saved <span>(before you started tracking)</span></label>
      <div class="amount-input cat-limit"><span>₹</span>
        <input id="goal-start" name="start" type="number" inputmode="numeric" min="0" step="500" placeholder="0" [ngModel]="starting()" (ngModelChange)="starting.set($event)">
      </div>

      <label class="field-label" for="goal-date">Reach it by <span>(optional)</span></label>
      <div class="date-row">
        <input class="form-input" id="goal-date" name="date" type="date" [min]="today" [ngModel]="targetDate()" (ngModelChange)="targetDate.set($event || null)">
        @if (targetDate()) { <button type="button" class="chip" (click)="targetDate.set(null)">No date</button> }
      </div>

      @if (preview(); as p) { <p class="goal-preview">{{ p }}</p> }
      @if (error()) { <p class="form-error" role="alert">{{ error() }}</p> }

      <div class="modal-actions">
        @if (goal) { <button type="button" class="text-button cat-hide" [disabled]="saving()" (click)="hide()">Hide goal</button> }
        <button class="primary-button" type="submit" data-tab="SAVING" [disabled]="saving()">{{ saving() ? 'Saving…' : goal ? 'Save changes' : 'Create goal' }} <i-lucide [img]="icons.Check"></i-lucide></button>
      </div>
    </form>
  </section>
</div>`
})
export class GoalSheetComponent implements OnInit {
  @Input() goal: Goal | null = null;
  /** Prefill for a new goal (e.g. the emergency-fund suggestion). */
  @Input() suggestion: Partial<GoalDraft> | null = null;
  @Input() monthStartDay = 5;
  @Output() saved = new EventEmitter<{ goal: Goal; created: boolean; hidden: boolean }>();
  @Output() closed = new EventEmitter<void>();

  readonly icons = { Check, Target, X };
  private readonly service = inject(BudgetService);
  readonly today = isoDate(new Date());
  name = '';
  icon = '🎯';
  readonly target = signal<number | null>(null);
  readonly starting = signal<number | null>(null);
  readonly targetDate = signal<string | null>(null);
  readonly saving = signal(false);
  readonly error = signal('');

  /** Money linked to this goal through entries; unchanged by this form. */
  private linked = 0;

  readonly preview = computed(() => {
    const target = Number(this.target());
    if (!(target > 0)) return null;
    const saved = (Number(this.starting()) || 0) + this.linked;
    const date = this.targetDate();
    const months = date ? monthsBetween(budgetMonthFor(new Date(), this.monthStartDay), budgetMonthFor(parseIso(date), this.monthStartDay)) : null;
    const plan = goalPlan({ targetAmount: target, saved } as Goal, months);
    const rupees = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
    if (plan.state === 'reached') return `Already reached — ${rupees(saved)} saved.`;
    if (plan.state === 'onTrack') return `Save about ${rupees(plan.perMonth!)} a month for ${months} ${months === 1 ? 'month' : 'months'} to reach ${rupees(target)}.`;
    if (plan.state === 'late') return `That date is this month or earlier — ${rupees(plan.left)} still to go.`;
    return `${rupees(plan.left)} to go. Add a date to see how much to save each month.`;
  });

  ngOnInit(): void {
    const g = this.goal;
    if (g) {
      this.name = g.name; this.icon = g.icon;
      this.target.set(g.targetAmount); this.starting.set(g.startingAmount || null); this.targetDate.set(g.targetDate);
      this.linked = g.saved - g.startingAmount;
      return;
    }
    const s = this.suggestion;
    if (s) { this.name = s.name ?? ''; this.icon = s.icon ?? '🎯'; this.target.set(s.targetAmount ?? null); this.targetDate.set(s.targetDate ?? null); }
  }

  @HostListener('document:keydown.escape') onEscape(): void { this.closed.emit(); }

  save(): void { this.send(false); }
  hide(): void { this.send(true); }

  private send(hide: boolean): void {
    if (this.saving()) return;
    const name = this.name.trim();
    const target = Number(this.target());
    const starting = Number(this.starting()) || 0;
    if (!name) { this.error.set('Give the goal a name.'); return; }
    if (!(target > 0)) { this.error.set('Enter a target greater than ₹0.'); return; }
    if (starting < 0) { this.error.set('Already saved can’t be negative.'); return; }
    const draft: GoalDraft = { name, icon: this.icon.trim() || '🎯', targetAmount: target, startingAmount: starting, targetDate: this.targetDate() || null };
    if (hide) draft.archived = true;
    this.saving.set(true);
    this.error.set('');
    const request = this.goal ? this.service.updateGoal(this.goal.id, draft) : this.service.createGoal(draft);
    request.subscribe({
      next: (goal) => { this.saving.set(false); this.saved.emit({ goal, created: !this.goal, hidden: hide }); },
      error: (err) => { this.saving.set(false); this.error.set(this.service.errorMessage(err, 'Could not save this goal.')); },
    });
  }
}
