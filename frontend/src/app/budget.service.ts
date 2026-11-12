import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { BudgetSettings, Category } from './models';

@Injectable({ providedIn: 'root' })
export class BudgetService {
  private readonly http = inject(HttpClient);
  private readonly api = `${API_BASE_URL}/api`;

  /** Fire-and-forget request that wakes a sleeping free-tier server while the app loads. */
  wake(): void { this.http.get(`${this.api}/health`).subscribe({ error: () => {} }); }

  categories(): Observable<Category[]> { return this.http.get<Category[]>(`${this.api}/categories`); }
  settings(): Observable<BudgetSettings> { return this.http.get<BudgetSettings>(`${this.api}/settings`); }
  saveSettings(settings: BudgetSettings): Observable<BudgetSettings> { return this.http.put<BudgetSettings>(`${this.api}/settings`, settings); }

  /** Turns a failed request into one short sentence for the person using the app. */
  errorMessage(err: unknown, fallback: string): string {
    if (!(err instanceof HttpErrorResponse) || err.status === 0) return 'No connection — check your signal and try again.';
    if (err.status === 401) return 'Server key missing or wrong — check Settings.';
    return typeof err.error?.message === 'string' && err.status === 400 ? err.error.message : fallback;
  }
}
