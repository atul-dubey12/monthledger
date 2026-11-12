# MonthLedger

A monthly budget tracker: salary in, then see how much went to **Needs**, **Wants** and **Savings** (target split 50 / 30 / 20), with savings goals and recurring bills. A sister app to [ShiftLedger](https://github.com/atul-dubey12/shiftledger), with the same look and the same setup.

The budget month starts on salary day (the 5th by default), so "November 2026" runs 5 Nov – 4 Dec. Both the start day and the split can be changed in Settings, and settings sync across devices.

See [docs/PLAN.md](docs/PLAN.md) for the full plan and build steps.

## Run locally

Runs next to ShiftLedger without clashing: API on **8081**, site on **4201**.

```bash
# API (H2 file database in backend/data/, no key needed locally)
cd backend && mvn spring-boot:run

# Site (proxies /api to :8081)
cd frontend && npm install && npm start   # http://localhost:4201
```

Tests: `cd backend && mvn test`.

## Stack

- **Frontend:** Angular 19 (standalone components + signals), lucide icons. Same design tokens as ShiftLedger.
- **Backend:** Spring Boot 3.5, JPA, Flyway. The same migrations run on local H2 (Postgres mode) and on Neon Postgres.
- **Hosting:** API on Render (Docker, `render.yaml`) + Postgres on Neon (its own database, separate from ShiftLedger). Site on GitHub Pages at https://atul-dubey12.github.io/monthledger/ (`cd frontend && npm run deploy`).
- **Access:** single user. Every `/api` request except `/api/health` needs the `X-Api-Key` header in production; the key is entered once per device in Settings.
