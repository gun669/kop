# KOP — Studio attendance & reporting

A multi-studio attendance, teacher-performance, and revenue/expense tracker,
built to run one yoga studio today and be sellable to other studios later.

## What's in this first build

- **Multi-tenant from the ground up.** Every table is scoped to a studio. One
  owner login (yours) sees every studio it's linked to and can switch between
  them; everyone else only sees the studio they're staffed at.
- **Roles**: owner, manager, receptionist, teacher (teacher accounts exist in
  the data model but don't have their own screens yet — see "Not built yet").
- **Receptionist check-in**: today's classes for the studio, search a guest by
  name, check them in (auto-uses their membership if they have one and burns a
  credit), or quick-add a first-timer.
- **Manager dashboard**: attendance trend, revenue vs. expenses, and a
  per-teacher performance table (classes taught, average attendance, no-show
  rate).
- **Revenue & expenses**: manual ledger entries (no payment processing yet —
  see "Not built yet").

## Not built yet (by design, given the timeline)

- Real payment processing (Stripe or similar) — revenue is currently entered
  by hand.
- Customer-facing booking/self-service (customers are checked in by
  reception, not booking themselves).
- Teacher-facing screens (their schedule, their own stats).
- Class scheduling UI (today's sessions come from the seed script — building
  a recurring-schedule editor is the natural next step).
- Multi-currency conversion (each studio has its own currency; the dashboard
  doesn't combine Istanbul's TRY and Uluwatu's USD into one number).

## Data model

`studios` → `studio_members` (who has which role at which studio) →
`teachers`, `guests`, `class_types`, `class_sessions`, `memberships`,
`sign_ins`, `expenses`, `revenue_entries`. See `src/db/schema.ts` for the
full picture — it's short enough to read end to end.

## Stack

Next.js (App Router) + TypeScript + Tailwind, Drizzle ORM against Postgres,
cookie-based sessions (no third-party auth vendor, so no per-user pricing
while you're small), Recharts for the dashboard.

---

## Running it locally

You need Node 20+ and a Postgres database (local or hosted — Neon and
Supabase both have free tiers, see deployment section below).

```bash
npm install
cp .env.example .env   # then fill in DATABASE_URL and SESSION_SECRET
npm run db:push        # creates all tables
npm run db:seed        # loads demo data for both studios
npm run dev
```

Open http://localhost:3000 and sign in with one of the seeded accounts —
all use the password `kop-demo-2026`:

| Email | Role |
|---|---|
| `gursoygun@gmail.com` | Owner — sees both studios, can switch |
| `reception@istanbulstudio.demo` | Receptionist — Istanbul only |
| `manager@alchemyuluwatu.demo` | Manager — Alchemy Uluwatu only |

**Change these before using it for real** — either update the seed script
with your real staff emails, or add a simple "create user" flow (not built
yet — right now users are created only by the seed script or directly in the
database).

`npm run db:studio` opens Drizzle's browser-based data viewer if you want to
look at or edit rows directly.

---

## Deploying so your real staff can use it

You don't need to touch a server. This is the standard, free-to-start path:

1. **GitHub** — create an account at github.com if you don't have one, then
   create a new empty repository (no README/license, so it stays empty).
   From this project's folder:
   ```bash
   git init
   git add .
   git commit -m "Initial KOP build"
   git branch -M main
   git remote add origin https://github.com/<you>/kop.git
   git push -u origin main
   ```

2. **A hosted Postgres database** — [neon.com](https://neon.com) or
   [supabase.com](https://supabase.com), both have generous free tiers.
   Create a project, copy the connection string it gives you (it looks like
   `postgresql://user:pass@host/dbname?sslmode=require`).

3. **Vercel** — sign up at [vercel.com](https://vercel.com) with your GitHub
   account, click "New Project," pick the `kop` repo you just pushed. Before
   deploying, add two environment variables (Vercel's project settings →
   Environment Variables):
   - `DATABASE_URL` — the connection string from step 2
   - `SESSION_SECRET` — any long random string (e.g. run
     `openssl rand -hex 32` locally and paste the result)

   Deploy. Vercel gives you a URL like `kop-yourname.vercel.app` — that's
   what you and your staff open on any phone, tablet, or laptop.

4. **Create the tables and seed data against the live database** — run this
   once from your own machine, pointed at the live `DATABASE_URL` (put it in
   your local `.env` temporarily):
   ```bash
   npm run db:push
   npm run db:seed
   ```
   Then edit the seed script (or add real staff by hand via `db:studio`) so
   the accounts match your actual team, and re-run — or, better, once this is
   real, build a proper "invite a staff member" flow instead of relying on
   the seed script.

From then on, any code change you want live is: push to GitHub, Vercel
redeploys automatically.

---

## Where to go next, roughly in order

1. Swap the seed-script-only user creation for a real "add staff member"
   screen (owner/manager can invite a receptionist or teacher by email).
2. A schedule editor, so class sessions don't have to be seeded by hand.
3. Teacher-facing view (their upcoming classes, their own attendance stats).
4. Real payments, once the free/manual version has proven itself with
   Istanbul and Alchemy Uluwatu.
