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
2. Open **SQL Editor** → **New query**, paste the *contents* of `supabase/migrations/0001_init.sql`, press **Run**.
   Then do the same for each later file in `supabase/migrations/` in number order (`0002_…`, `0003_…`).
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
   `SUPABASE_SERVICE_ROLE_KEY`, `ALLOW_COMPANY_SIGNUP`, `OWNER_EMAILS`).
3. Deploy, then point your domain at it and update the Supabase *Site URL* (step 1.4).

Set `ALLOW_COMPANY_SIGNUP=false` if you want to onboard companies yourself instead of letting them sign up.

## Marketing page
The home page (`/`) is a public page in Kiswahili and English with a **Request a demo** form.
Requests appear in the owner console under **Demo requests**. Add `?ref=something` to the link
(e.g. `/?ref=facebook`) to see which channel each request came from — the console has a link maker.
Requires migration `0004_leads.sql`. Optional: `NEXT_PUBLIC_SALES_WHATSAPP` shows a WhatsApp button.

## Owner console (Serengeti Labs)
Open **/owner** while signed in with an email listed in `OWNER_EMAILS`. From there you can:
- see every client company with staff, trucks, this month's consignments and money, and last activity
- add a company yourself (with a temporary Admin password) and close open self sign-up
- mark a company Trial, Active, Overdue or **Suspended** (suspended staff lose access; data is kept)
- reset any staff member's password, keep private notes, and post an announcement to all clients
- review the owner activity log

Requires migration `0003_client_accounts.sql` and the `OWNER_EMAILS` environment variable.

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

## Arrival and payment
The **Arrivals** menu is the destination desk: trucks on the road (mark them arrived), goods waiting
for customers (notify, take payment and release), and what was released today.
When a truck is marked **arrived**, the trip shows arrival notices with unpaid receivers first.
Unpaid receivers are told the amount and how to pay (from **Settings → How customers pay**), then to
come with ID to collect. Goods can't be released until paid — the database refuses it. Unpaid goods
waiting 2+ days are flagged on the Overview, and each one has a **Payment reminder** message.

## Customer messages
SMS and WhatsApp buttons open the staff member's phone with the message ready to send, and the
app records who sent what. Fully automatic sending needs an SMS gateway (e.g. Beem Africa,
NextSMS) and the WhatsApp Business API — a natural next step.

---
© Serengeti Labs
