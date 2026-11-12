import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { BudgetSettings, Category, Entry, EntryDraft } from './models';

@Injectable({ providedIn: 'root' })
export class BudgetService {
  private readonly http = inject(HttpClient);
  private readonly api = `${API_BASE_URL}/api`;

  /** Fire-and-forget request that wakes a sleeping free-tier server while the app loads. */
  wake(): void { this.http.get(`${this.api}/health`).subscribe({ error: () => {} }); }

  categories(): Observable<Category[]> { return this.http.get<Category[]>(`${this.api}/categories`); }
  settings(): Observable<BudgetSettings> { return this.http.get<BudgetSettings>(`${this.api}/settings`); }
  saveSettings(settings: BudgetSettings): Observable<BudgetSettings> { return this.http.put<BudgetSettings>(`${this.api}/settings`, settings); }

  /** Both dates inclusive (yyyy-MM-dd), newest first. */
  entries(from: string, to: string): Observable<Entry[]> { return this.http.get<Entry[]>(`${this.api}/entries`, { params: { from, to } }); }
  createEntry(draft: EntryDraft): Observable<Entry> { return this.http.post<Entry>(`${this.api}/entries`, draft); }
  updateEntry(id: number, draft: EntryDraft): Observable<Entry> { return this.http.put<Entry>(`${this.api}/entries/${id}`, draft); }
  deleteEntry(id: number): Observable<void> { return this.http.delete<void>(`${this.api}/entries/${id}`); }

  /** Turns a failed request into one short sentence for the person using the app. */
  errorMessage(err: unknown, fallback: string): string {
    if (!(err instanceof HttpErrorResponse) || err.status === 0) return 'No connection — check your signal and try again.';
    if (err.status === 401) return 'Server key missing or wrong — check Settings.';
    return typeof err.error?.message === 'string' && (err.status === 400 || err.status === 404) ? err.error.message : fallback;
  }
}
