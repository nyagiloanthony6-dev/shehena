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
| **Branch staff** | Works at one office (e.g. Dodoma). Sees only goods loaded to that office and goods they received themselves. Receives goods at their office, loads and dispatches trucks leaving it, marks trucks arriving, notifies customers, takes payment and releases with a delivery note. Opens monthly bill accounts and records claims and their payments for their own office only. No reports or settings |

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

## Home page
There is no public marketing page. The site address opens the sign-in page (or the app when already
signed in). Links with `?ref=code` still work: they open sign-in and credit a company that registers
to the salesperson with that code.

## Owner console (Serengeti Labs)
Open **/owner** while signed in with an email listed in `OWNER_EMAILS`. From there you can:
- see every client company with staff, trucks, this month's consignments and money, and last activity
- add a company yourself (with a temporary Admin password) and close open self sign-up
- mark a company Trial, Active, Overdue or **Suspended** (suspended staff lose access; data is kept)
- reset any staff member's password, keep private notes, and post an announcement to all clients
- review the owner activity log

Requires migration `0003_client_accounts.sql` and the `OWNER_EMAILS` environment variable.

## Billing client companies
In the owner console, **Price bands** set the monthly fee by number of trucks (default TZS 80,000 for 1
truck, 150,000 for 2–3, 250,000 for 4–6, 350,000 for 7–10, 450,000 for 11+). **Billing rules** set the free
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

## Offices (branches)
Registration asks where the company sends goods from (head office) and the towns it delivers to.
The Admin changes them in **Settings → Offices and routes**. Branch staff are assigned to one of these
offices, and receiving and loading list the company's offices first. Requires `0011_offices.sql`
(existing companies start with their head office plus every town they've already sent goods to).

## Branch staff (destination offices)
Add them in **Settings → Staff** with the role *Branch staff* and their office. The database limits what
they can see and change (migration `0010_branch_staff.sql`); the Admin, cashiers and CEO see everything.

Branch staff can also open **monthly bill accounts** and record **claims** for lost or damaged goods,
and take payments on both (migration `0012_branch_bills_claims.sql`). Each account and claim is tagged
with the office it belongs to, and branch staff only see their own office's. Editing or closing an
account or claim stays with the Admin, who sees all offices and can move an account to another office.

## Delivery notes
At the destination, **Release goods** (Arrivals or the consignment) asks who is collecting: name, phone,
ID type and number, and remarks; unpaid goods take the payment in the same step. Saving prints an
80 mm delivery note (DN-…) with the goods, packages, collector, ID and signature lines, and keeps the
details on the consignment for reprinting. If someone other than the receiver collects, staff see a
warning. Undoing a collection clears the delivery note.

## Own and rental trucks
In **Settings → Vehicles** each truck is *Our own* or *Rental* with the owner and rent (per trip or per
month). A truck hired for one trip can be entered as rental when loading starts. Each trip keeps its
rent; only the Admin can change it. **Reports → Trucks & rentals** shows collections after rent.

## Reports (Admin and CEO)
Reports has a period (today, 7 days, 30 days, this month, all time or chosen dates) and tabs:
Overview · Paid & unpaid (with unpaid by age and who owes) · Trucks & rentals · Claims & refunds ·
Discounts · Monthly bills · Deliveries. Every table has **Download (Excel)** (CSV that opens in Excel).

Requires migration `0009_delivery_rentals.sql`.

## Trucks by date and manifests
**Loading bay** and **Arrivals** have *Trucks by date*: pick a day and see every truck loaded, departed
or arrived that day with consignments, packages, money and what's still to collect; mark a truck
arrived straight from the list. Each trip shows the full manifest (sender, receiver, phone, goods,
packages, charge, payment) and downloads it as an A4 PDF for the driver and the destination office.

## Monthly bill customers (wateja wa bili)
The Admin opens accounts under **Monthly bills**. When receiving goods choose **Monthly bill** and the
customer: nothing is collected at the counter, the receipt and messages say it's on the monthly bill,
and the goods can be released without payment. Each account shows a monthly statement (brought
forward, goods, payments, balance) as a PDF or a WhatsApp/SMS message, and staff record payments
against it. Only the Admin opens, edits or closes accounts, removes payments, or takes goods off a bill.

## Discounts
A discount (with its reason) can be given when receiving goods or later, before payment. The receipt
shows subtotal, discount and total; the database keeps the charge before and after and who gave it.
**Reports → Discounts given** totals them by staff member. A paid consignment can't be discounted.

## Claims (changamoto)
**Claims** records goods that were lost, damaged or broken: the customer, waybill, type of problem,
value of the goods, compensation agreed, each payment with its date, and the balance still owed.
Start one from a consignment (**Report lost or damaged goods**) or from the Claims screen. Cashiers
record claims and payments; only the Admin changes agreed amounts, closes claims or removes payments.

Requires migration `0008_bills_discounts_claims.sql`.

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
