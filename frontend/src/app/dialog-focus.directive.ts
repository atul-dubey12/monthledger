import { AfterViewInit, Directive, ElementRef, HostListener, OnDestroy, inject } from '@angular/core';

/** Keep keyboard navigation inside an open sheet and return focus to its trigger. */
@Directive({ selector: '[appDialogFocus]', host: { tabindex: '-1' } })
export class DialogFocusDirective implements AfterViewInit, OnDestroy {
  private readonly element: HTMLElement = inject(ElementRef).nativeElement;
  private readonly trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  private frame = 0;

  ngAfterViewInit(): void {
    this.frame = requestAnimationFrame(() => {
      // Focus the dialog itself so its title is announced before any form fields.
      this.element.focus({ preventScroll: true });
    });
  }

  @HostListener('keydown', ['$event']) onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const controls = Array.from(this.element.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [tabindex]'
    )).filter(el => el.tabIndex >= 0 && !el.matches(':disabled, [hidden], [aria-hidden="true"]') && el.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first) {
      event.preventDefault();
      this.element.focus();
    } else if (event.shiftKey && (document.activeElement === first || document.activeElement === this.element)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
    if (this.trigger?.isConnected) this.trigger.focus({ preventScroll: true });
  }
}
