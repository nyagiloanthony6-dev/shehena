# Shehena

Cargo management for road transport between Tanzanian regions — receive goods, issue receipts,
load trucks against collection targets, dispatch, and notify customers by SMS / WhatsApp.

**Developed by Serengeti Labs.**

- Next.js 15 (App Router) + TypeScript
- Supabase: Postgres database, email/password login, live updates between staff
- Many companies on one installation; each company's data is isolated by Row Level Security

## Roles

| Role | Can do |
|---|---|
| **Admin** | Everything: staff accounts, vehicles, company settings, targets, delete records, undo payments |
| **Cashier** | Receive goods, issue receipts, record payments, load trucks, dispatch, send notices |
| **CEO** | Overview, monthly collections, reports by truck / trip / paid & unpaid, set targets. Read-only otherwise |

These rules are enforced **in the database**, not just hidden in the screens.

## Set up (about 15 minutes)

### 1. Create the Supabase project
1. Go to <https://supabase.com> → **New project**. Pick a region close to Tanzania (e.g. *Frankfurt* or *Cape Town*).
2. Open **SQL Editor** → **New query**, paste everything in `supabase/migrations/0001_init.sql`, press **Run**.
3. **Authentication → Providers → Email**: keep *Email* enabled. *Confirm email* can stay on —
   staff accounts created by the Admin are confirmed automatically.
4. **Authentication → URL Configuration**: set *Site URL* to your live address
   (e.g. `https://shehena.co.tz`) and add `https://shehena.co.tz/auth/callback` to *Redirect URLs*
   (needed for "Forgot password?").
5. **Project Settings → API**: copy the *Project URL*, the *anon public* key and the *service_role* key.

### 2. Run it on your computer
```bash
cp .env.example .env.local     # paste the three values from step 1.5
npm install
npm run dev                    # http://localhost:3000
```
Open the app, click **Register a new company**, and you become that company's Admin.
Add cashiers, the CEO and vehicles under **Settings**.

### 3. Deploy on Vercel
1. Push this folder to GitHub, then **Import** the repo at <https://vercel.com/new>.
2. Add the same environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `ALLOW_COMPANY_SIGNUP`).
3. Deploy, then point your domain at it and update the Supabase *Site URL* (step 1.4).

Set `ALLOW_COMPANY_SIGNUP=false` if you want to onboard companies yourself instead of letting them sign up.

## How it fits together

```
src/
  app/
    login/  signup/  reset/      sign in, register a company, choose a new password
    auth/callback/               finishes the password-reset email link
    app/page.tsx                 loads the signed-in staff member + company
    app/actions.ts               Admin-only staff management (create, role, password, disable)
  components/
    CargoApp.tsx                 shell: sidebar, phone navigation, detail panels
    store.tsx                    loads data, live updates, saves changes
    views/                       Overview, Consignments, Receive, Loading, Reports, Settings
    sheets.tsx                   consignment and trip detail panels
    parts.tsx, charts.tsx        receipt, truck meter, notices, charts
  lib/domain.ts                  types, regions, Kiswahili/English messages, helpers
supabase/
  migrations/0001_init.sql       tables, security rules, role triggers
  tests/                         database security tests + local mock used for UI testing
```

### Database security tests
With a local Postgres 16:
```bash
psql -d test -f supabase/tests/auth_stub.sql -f supabase/migrations/0001_init.sql
psql -d test -f supabase/tests/rls_test.sql
```
Covers: companies can't see or change each other's data; cashiers can't change targets, undo
payments, delete records or edit settings; the CEO can only set targets; disabled staff and
signed-out visitors see nothing.

## Customer messages
SMS and WhatsApp buttons open the staff member's phone with the message ready to send, and the
app records who sent what. Fully automatic sending needs an SMS gateway (e.g. Beem Africa,
NextSMS) and the WhatsApp Business API — a natural next step.

---
© Serengeti Labs
