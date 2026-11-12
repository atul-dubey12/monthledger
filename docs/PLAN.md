# MonthLedger: monthly budget tracker (plan)

Working name **MonthLedger**, a sister app to ShiftLedger (`../Expense_Tracker`). Same look, same stack, same "one server, every device" setup.

**Goal:** when the salary comes in, see where every rupee goes. That means:
- how much went to **Needs** (rent, bills, groceries, EMI)
- how much went to **Wants** (food delivery, shopping, outings)
- how much was **Saved**
- whether the savings goals are on track

---

## 1. What the app does

### The month at a glance (home screen)
- **Income this month**: salary plus anything else.
- **Spent**, **Saved** and **Left to spend**, with a "safe to spend per day" figure (left to spend ÷ days left in the month).
- **Needs / Wants / Savings bars** against your targets. The default split is 50 / 30 / 20 and can be changed. Example: "Wants: ₹7,800 of ₹9,000 (87%)".
- **Category breakdown** (rent, groceries, fuel, food delivery, shopping…), each with its own budget and a progress bar. It turns amber at 80% and red when over.
- **Daily spending chart** for the month, the same style as ShiftLedger's earnings chart. Tap a day to see its entries.
- **Compared with last month**: "Wants up 18%, mostly Food delivery".

### Adding money in and out
- **Quick add** (like ShiftLedger's Quick order): type an amount, tap a category chip, done. Two taps for the common case.
- Every entry has: date, amount, kind (**Income / Expense / Saving**), category, payment mode (UPI / card / cash), and an optional note.
- Each category belongs to a bucket (Needs, Wants or Savings), so you never have to choose the bucket yourself.

### Savings tracking
- **Savings goals**: name, target amount, optional target date. Examples: Emergency fund ₹1,00,000, Bike service ₹8,000, Goa trip.
- Putting money into savings is an entry of kind **Saving**, linked to a goal or to "General savings". Taking money out is also recorded, so the totals stay honest.
- Each goal shows saved / target, % done, and "₹X per month needed to hit it by <date>".
- **Savings rate trend**: % of income saved, month by month, over the last 6–12 months.

### Recurring bills
- Mark something as monthly (rent, EMI, phone recharge, SIP, subscriptions) along with its usual day.
- At the start of each month a **"Due this month"** list shows them. Tap ✓ when paid and it becomes a normal entry; nothing is added automatically behind your back.

### Insights (short, plain lines)
- "Food delivery is your biggest want: ₹3,200 this month."
- "You saved 14% this month. Your target is 20%."
- "At this pace you'll run out of budget on the 24th."
- "You haven't logged anything for 3 days."

### Backup & settings
- CSV export (this month / everything) and CSV import with duplicate skipping, the same as ShiftLedger.
- Settings: name, target split, which day your budget month starts (see Decisions), theme, server key.

### Later (not v1)
- Bring ShiftLedger take-home into MonthLedger automatically as income.
- Offline saving with sync later, and an installable app (PWA).
- Reading bank SMS or statements to log spends automatically.

---

## 2. How it's built (copied from ShiftLedger)

```
Phone / laptop ──HTTPS + X-Api-Key──▶ Render: monthledger-api (Spring Boot, Docker) ──▶ Neon: Postgres (own database)
GitHub Pages: atul-dubey12.github.io/monthledger/
```

| Part | Choice | Reused from ShiftLedger |
|---|---|---|
| Frontend | Angular (standalone components + signals), lucide icons | `styles.css` design tokens, light/dark theme, modal/sheet, toast, chart, Settings + server key, API interceptor, wake-up banner |
| Backend | Spring Boot 3, JPA, Flyway | `ApiKeyFilter`, CORS config, health endpoint, Dockerfile, `render.yaml`, CSV import/export pattern |
| Database | Postgres on Neon, a **separate database** from ShiftLedger | migration style |
| Hosting | Render (API) + GitHub Pages (site) | deploy script |
| Repo | New Git repo `atul-dubey12/monthledger` in this folder | — |

Local dev works like ShiftLedger: `npm start` + Spring Boot on H2, with no key.

Note: ShiftLedger uses Angular 19, which is out of support. Start this app on the **current Angular release** and Node LTS instead of copying the old versions.

### Data model (v1)
- `categories`: id, name, emoji/icon, bucket (`NEED|WANT|SAVING`), monthly budget (nullable), archived. Seeded with sensible defaults (below).
- `entries`: id, date, kind (`INCOME|EXPENSE|SAVING|SAVING_WITHDRAWAL`), amount, category_id, goal_id (nullable), payment_mode (`UPI|CARD|CASH|BANK`), note.
- `goals`: id, name, target_amount, target_date (nullable), archived.
- `recurring`: id, name, amount, category_id, day_of_month, active.
- `settings`: single row with needs/wants/savings %, month start day, name.

Default categories:
- **Needs**: Rent, Groceries, Bills & recharge, Fuel & transport, EMI / loan, Health, Family.
- **Wants**: Food delivery & eating out, Shopping, Entertainment & OTT, Travel, Personal care, Gifts.
- **Savings**: Emergency fund, SIP / investments, General savings.
- **Income**: Salary, Delivery earnings, Other.

### API (v1)
- `/api/entries`: list (by month), create, update, delete, `export`, `import`
- `/api/categories`
- `/api/goals`
- `/api/recurring`
- `/api/settings`
- `/api/summary?month=2026-11`: totals per bucket and per category. The server does this sum so the phone stays fast.
- `/api/health`

---

## 3. Build steps (one per session; check before moving on)

1. **Scaffold.** ✅ DONE (12 Nov 2026). Git repo, Angular 19 app (same as ShiftLedger, runs on Node 18), Spring Boot app, design tokens and shell, Flyway V1 with seeded categories + settings (start day 5, 50/30/20), `/api/categories` + `/api/settings`, Settings sheet with server key, split and start day. Local: API :8081, site :4201.
2. **Entries + month view.** ✅ DONE (12 Nov 2026). Flyway V2 `entries` (kind INCOME / EXPENSE / SAVING / SAVING_WITHDRAWAL, category must match the kind's bucket), `/api/entries` list by date range + create / update / delete. One add/edit sheet (Expense · Income · Saving tabs, remembers last category and payment mode), Income / Spent / Saved / Left-to-spend cards with ₹ per day, actual vs target on each 50/30/20 bucket, per-category amounts, activity by day with search, filters, edit, delete + undo.
3. **Budgets.** ✅ DONE (12 Nov 2026). Flyway V3 adds Home contribution (Need, ₹15,000), Gym & fitness and Supplements (Wants, ₹1,500 each) and starting limits for eating out / shopping / personal care. Categories & limits sheet (add, rename, hide, monthly limit, check against the 50/30 targets; a used category can't change bucket). Budget watch (amber from 80%, red when over, "used in full" at exactly 100%), daily spending chart (Wants / All) with tap-to-filter, compared with the same point last month, and a ⚡ Quick expense sheet (usual categories, common amounts, live limit warning).
4. **Savings goals.** Goals CRUD, saving entries linked to goals, goal progress, monthly amount needed, savings-rate trend.
5. **Recurring + insights.** "Due this month" list, the insight lines, comparison with last month.
6. **Backup.** CSV export and import with duplicate skipping.
7. **Go live.** New Neon database, new Render service from `render.yaml` (new `API_KEY`), GitHub Pages deploy. Same switch-over as ShiftLedger: enter the key once per device.

After step 2 the app is already usable for daily logging. Steps 3–6 add the "where is my money going" features.

---

## 4. Decisions (defaults used unless you change them)

| Question | Default |
|---|---|
| When does a budget month start? | **5th of the month (salary day)**, so a month runs 5th → 4th. Changeable in Settings. ✅ decided |
| Target split | 50% needs / 30% wants / 20% savings ✅ decided |
| Currency | ₹ INR, Indian number format (1,00,000) |
| Users | Just you, one server key, the same as ShiftLedger ✅ decided |
| Separate app or inside ShiftLedger? | **Separate app, separate Git repo, own database** ✅ decided. Delivery work money and household money stay clean, and either app can change without breaking the other. |
| Free hosting | Render's free tier allows more than one free service, but they share monthly hours. Both apps sleep when idle, so this should fit. Check current limits when creating the service. |
