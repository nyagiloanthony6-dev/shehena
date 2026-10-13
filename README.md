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
   `SUPABASE_SERVICE_ROLE_KEY`, `ALLOW_COMPANY_SIGNUP`, `OWNER_EMAILS`, `CRON_SECRET`).
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

## Billing client companies
In the owner console, **Price bands** set the monthly fee by number of trucks (default TZS 50,000 for 1
truck, 100,000 for 2–3, 180,000 for 4–6, 270,000 for 7–10, 350,000 for 11+). **Billing rules** set the free
trial length, grace days, automatic suspension, and how clients pay you.
- New companies start on a free trial. Open a company and **Record a payment** (months, amount, any setup
  fee, M-Pesa code) — paid-until moves forward and a PDF receipt is ready for the client.
- Status follows the dates: paid up → Active, in trial → Trial, past due → Overdue (the client's Admin and
  CEO see the amount, how to pay and the suspension date), past due + grace days → Suspended.
  Changing a status by hand turns this off for that company until you press **Make automatic**.
- Clients' Admins see their plan, payments and receipts under **Settings → Shehena subscription**.
- Statuses refresh whenever the app or console opens, and daily via Vercel Cron (`vercel.json`). Set a
  `CRON_SECRET` environment variable in Vercel (any long random text) so only Vercel can call it.

## Sales team and commission
Add salespeople under **Sales team**. Each gets a link (`/?ref=juma`): demo requests from it show their
name, and a company that registers after opening it is credited to them (or set **Brought in by** on a
client). When you record a client payment, the salesperson earns automatically:
signing bonus (default 100% of the first month), setup fee share (30%) and monthly commission (10% of
payments for 12 months). Add allowances or adjustments, then **Record payout** to pay everything owed —
each payout has a PDF statement. Removing a client payment takes back its commission.

Requires migration `0006_billing.sql`.

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

## Goods found on arrival
Sometimes goods come off a truck that were never recorded at loading. At the destination, open the
arrived truck (Arrivals → *Arrived this week*, or the trip) and press **Record found goods**: enter the
receiver (sender if known), the goods and the proper charge, and how they were found. The record joins
that truck's trip, is marked **Found**, and prints a receipt and stickers like any other consignment.
- Cashiers' records wait for the Admin under **Arrivals → Found goods to check**; the Admin opens each
  and presses **Mark checked**. The Admin's own records count as checked.
- **Settings → Goods found on arrival** lets the Admin allow cashiers, or keep it Admin-only.
- The database enforces it: only allowed roles can record found goods, only on an arrived truck; only
  the Admin can mark them checked; after checking, only the Admin can change the charge.
Requires migration `0007_found_goods.sql`.

## Receipt and package stickers
When goods are saved, one PDF downloads with the sender's receipt followed by a sticker for every
package (e.g. 13 packages → 13 stickers, "3 / 13"). Stickers show the company, destination (large),
origin, waybill number, package number, date and a QR code of the waybill — **never the amount,
names or phone numbers**. Sticker size (100×75, 100×150, 80 mm roll, or A4 with 8 per page), whether
to show the goods description, and the automatic download are set per device under
**Sticker settings** on any consignment. Reprint any time from the consignment.

## Several items in one consignment
A sender can bring different goods in one visit (e.g. 10 cartons of oil, 2 mattresses, a spare tyre),
each with its own charge. **Receive goods** has one line per kind of goods — enter a price per package
and the charge is worked out, or type the charge directly. It is still one waybill, one receipt and one
payment; the receipt lists every line. The database recomputes the totals from the lines, so truck,
report and receipt figures always agree. Requires migration `0005_multi_item.sql`.

## Customer messages
SMS and WhatsApp buttons open the staff member's phone with the message ready to send, and the
app records who sent what. Fully automatic sending needs an SMS gateway (e.g. Beem Africa,
NextSMS) and the WhatsApp Business API — a natural next step.

---
© Serengeti Labs
