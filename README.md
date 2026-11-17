# REMS — milestones 1–6

Private room workspace built with Next.js 16.4.6, React 19.3, TypeScript, Tailwind CSS 4.3.3, mysql2 3.24.6, and the existing MySQL `rems` database. Verified with Node.js 22.15.0 and MySQL 8.0.46.

The application provides username/password login, persistent sessions, protected pages, admin-only account creation, personal expenses, confirmed historical participation, monthly allocations, an admin-managed settlement fund, validated monthly closure, inclusive departure settlement with zero-balance account deactivation, monthly A4 report previews, and genuine editable Word downloads for admins. Arrivals, temporary absences, password reset operations, and deployment remain deferred.

## Local setup

Run these commands from `rems/`. On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

1. Install the locked dependencies with Node.js 22:

   ```powershell
   npm.cmd ci
   ```

2. Ensure MySQL 8.0 is running and the existing `rems` database is available. Copy the template **only if you do not already have `.env.local`**:

   ```powershell
   Copy-Item .env.example .env.local
   ```

   Edit `.env.local` with your MySQL host, port, username, and password. Keep `DB_NAME=rems`. Set `APP_ORIGIN=http://localhost:3000`, with no trailing slash, and open the app using that exact origin. Changing the port requires changing `APP_ORIGIN` too. All credentials stay on the server; `.env.local` is ignored by Git. The template contains placeholders only. Next.js expands `$` in environment values, so escape literal dollar signs as `\$`.

3. Check the connection and apply migrations:

   ```powershell
   npm.cmd run db:check
   npm.cmd run db:migrate
   ```

   These commands connect to the existing database. They do not create, drop, or replace `rems`. The migration account needs CREATE, ALTER, INDEX, REFERENCES, SELECT, INSERT, and UPDATE privileges on `rems` for current/future migrations. Use a separate account with only SELECT, INSERT, UPDATE, DELETE for the running application on the VPS.

4. Create the initial admin in an interactive terminal:

   ```powershell
   npm.cmd run admin:create
   ```

   Enter your chosen username and enter the password twice. Password input is hidden. The command accepts no password arguments and contains no default credentials. It refuses to replace an existing admin; concurrent setup is serialized, and a database uniqueness constraint permits only one admin. Cancel with Ctrl+C.

   Usernames have 3–32 ASCII letters/numbers/dots/underscores/hyphens, begin with a letter or number, and are normalized to lowercase. Passwords contain **exactly eight Unicode characters**, as specified by SRS v3, and are never trimmed. This is a deliberate SRS constraint, rather than an eight-character minimum.

5. Initialize the first accounting month explicitly, once. For this installation the selected month is **Aqrab 1405**:

   ```powershell
   npm.cmd run period:init -- --year 1405 --month 8
   ```

   This creates the first month as `open`. Repeating the same initialization preserves its existing state; selecting a different first month afterward is rejected. There is no reset, reopen, force-close, or bypass command. Expenses before the first month are rejected. Subsequent months are enabled through validated settlement closure in the admin interface.

6. Start the application:

   ```powershell
   npm.cmd run dev
   ```

   Open http://localhost:3000, sign in, and use **Roommates** to create roommate accounts. Deliver each password privately. Use **Add Expense** and **My Expenses** for personal spending. The admin also has **Expense review**. There is no public registration or ability to assign admin access through the account form/API.

7. As admin, open **Participation** (`/admin/participation`). Review and explicitly select everyone who participated from **1 Aqrab 1405**, including people with zero spending. Include the admin only if the admin was a resident. Create any missing resident accounts before confirmation. Review the selected names, then click **Confirm these roommates**. No account is preselected and account creation timestamps never establish residence. This confirmation fixes the initial roster; arrivals and temporary-absence policies are still undecided.

   Until this step is complete, **My balance** and **Room balances** show **Roommates must be confirmed**, with no guessed financial figures. The migrations do not automatically confirm anyone.

8. Use **Settlement fund** (`/admin/settlements`) to review a month, begin settlement, record actual money received/paid, correct erroneous records through linked reversals, and close only when all participant balances and fund cash are zero. **My settlements** (`/settlements`) gives each person only their own payment history and outstanding amount. After closure, explicitly reconfirm the eligible continuing roster for the immediately following month. Use **Departures** (`/admin/departures`) to review and finalize an inclusive leaving cutoff, settle that roommate through the same fund, and deactivate only after all their obligations reach zero.

9. Use **My report** (`/reports`) for your own monthly expenses and settlement summary. The admin has **Monthly reports** (`/admin/reports`): first choose **Entire Room** or **Individual Person**, select the roommate when needed, then select the Shamsi year/month. **View report** replaces the displayed selection. **Print A4 preview** and the admin-only **Download Word (.docx)** controls stay outside the document.

For a local production build:

```powershell
npm.cmd run build
npm.cmd start
```

`tsx` is needed by the setup/maintenance commands and tests, so run those with development dependencies installed. For the VPS, use a TLS reverse proxy, set `APP_ORIGIN` to the exact public HTTPS origin, and keep MySQL private. HTTPS origins automatically enable Secure cookies. HTTP origins are accepted only for loopback development. Run migrations explicitly before starting a new release; builds and requests never migrate automatically.

## Security and persistence

- Passwords use Node.js scrypt with a random 16-byte salt, N=131072, r=8, p=1, a 64-byte key, and timing-safe comparison. Password hashes never appear in account listings or client props.
- Sessions last seven days, persist in MySQL, and use random 256-bit opaque tokens. Only SHA-256 token hashes are stored in MySQL. Cookies are HttpOnly, SameSite=Lax, host-only, and Secure on HTTPS. Successful login rotates the current browser session. Logout deletes the server record and expires the cookie. Other devices retain their independent sessions.
- Every protected page validates the session on the server. Admin data services and API handlers also check the current database role. Anonymous pages redirect to login; API calls return 401 for anonymous users and 403 for roommates attempting admin operations. The roommate account page displays only the current user's details.
- Mutations require POST and an Origin matching configured `APP_ORIGIN`; cross-site submissions are rejected. SQL values use prepared parameters; usernames are protected by a database unique constraint. Form bodies are limited to 4 KiB.
- Login allows ten attempts per normalized username in a 15-minute window, including unknown usernames. Limits persist across restarts. Successful login clears that username's counter. Other usernames remain usable when one is limited.
- User-specific pages render dynamically with Cache Components disabled. Session records are checked on every request, rather than trusting a client role or a layout-only check.

Expired sessions are already invalid. Periodically reclaim expired session and throttle rows with:

```powershell
npm.cmd run sessions:cleanup
```

## Versioned migrations

`migrations/001_users.sql`, `002_sessions.sql`, and `003_login_throttle.sql` create prefixed authentication tables. `rems_schema_migrations` records filenames, SHA-256 checksums, application status, and timestamps. Running migrations again is safe. A MySQL advisory lock prevents concurrent runners.

Milestone 2 appends migrations `004`–`009`: accounting periods, a singleton accounting state and its initial row, expenses, expense audit records, and persistent submission keys. These migrations add tables without resetting authentication, users, sessions, or other existing data. The first three migration files are unchanged.

Milestone 3 appends `010`–`014`: explicit participation confirmation, historical membership dates, allocation freeze boundaries, finalized expense source fingerprints, and finalized per-person minor-unit shares. Existing tables, expenses, users, and sessions are preserved. No snapshot or roster is populated automatically.

Milestone 4 appends `015`–`021`: month-specific participant confirmation (backfilled from existing initial membership), settlement review metadata, frozen initial balances, an append-only payment/reversal ledger, persistent retry keys, and a signed-decimal balance constraint correction. Existing confirmed participation, expenses, audits, and allocation snapshots are preserved. The correction casts unsigned decimal spending/share operands to signed decimals before subtraction so legitimate debtor balances remain negative. Applied migrations were not edited.

Milestone 5 appends `022_account_deactivation.sql`, `023_cutoff_balances.sql`, `024_departures.sql`, and `025_ledger_review_basis.sql`. These add account deactivation audit fields, signed cutoff balances, inclusive departure records, and an immutable allocation-basis reference on the existing fund ledger. The ledger's participant foreign key now references the confirmed monthly roster so reviewed cutoff payments can be recorded while the month is open. Existing month-end payments retain their original monthly basis; no historical payment or allocation is recreated. No roster or departure is populated automatically.

Append files named `026_description.sql`, etc.; each file contains one SQL statement. Never edit an applied migration. The runner refuses altered/missing applied files, duplicate version numbers, out-of-order additions, and incomplete migrations. Line endings are normalized for checksums across Windows/Linux.

MySQL DDL implicitly commits, so the runner writes an `applying` marker before each statement. If interrupted, it stops on the next run instead of replaying uncertain DDL. Inspect the schema and marker with a database administrator, finish or repair the specific statement, and reconcile its migration record before continuing. There is intentionally no automatic rollback, reset, or destructive repair command.

## Verification

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
```

The integration suite requires a current production build, available MySQL, and a local test connection account able to CREATE/DROP DATABASE. It reads the local connection settings, creates a randomly named `rems_test_...` database, applies real migrations, starts an isolated production server on an available loopback port, and removes only its generated test database afterward. It never clears or seeds the real `rems` database. If a process is forcibly terminated, a `rems_test_...` database may remain for manual inspection/removal.

Milestone 5 baseline verification: **76 tests passed, zero failed or skipped**; lint, type checking, and the production build passed. Migrations 022–025 were applied locally without changing applied migration files. A read-only comparison confirmed that live financial and participation data remained unchanged. Example payments, departures, deactivations, and closures ran only in disposable test databases.

Tests retain the authentication and expense checks: ownership, admin review, invalid input, exact decimal totals, simultaneous duplicate submissions, version conflicts, audit rollback, soft deletion, period locks and concurrent status changes, pagination, leap years, Kabul midnight, and Hoot/Hamal accounting boundaries. Older calendar fixtures explicitly enable their test periods; production periods can be enabled only by initialization or validated preceding-month closure.

Allocation tests cover the supplied two-person/five-person examples, zero-spending participants, rotating remainders, expense edits/deletion, roster confirmation/retries, privacy, account/membership separation, inclusive departure eligibility, preserved finalized snapshots, unsafe-history rejection, and blocked backdated writes. Each integration suite creates its own disposable `rems_test_...` database and production server.

Settlement tests exercise the complete five-roommate collection/payout example, partial receipts, insufficient cash, wrong-direction payments, overpayments, concurrent distinct requests, persistent retries, reason-required reversals, duplicate reversals, dependent payout corrections, privacy, frozen expenses/rosters, stale review rejection, atomic freeze rollback, ledger/retry rollback, premature closure, tampered invariants, atomic closure/activation rollback, repeated closure, next-month reconfirmation, the admin's own contribution/reimbursement, and a final payout racing with closure.

The signed-decimal regression also checks the actual frozen database values (+500 / -500 / -1,000 / -500 / +1,500 AFN). It verifies that the database still rejects an incorrect balance equation and zero/negative expense or payment amounts, and that the payment API rejects nonpositive amounts. This test uses only its disposable test database.

Departure tests advance disposable periods through genuinely validated closure to Hamal 1406, preserving the configured Aqrab 1405 start. They cover the requested 7,500 AFN example, the actual 500 AFN payout, later four-way allocations, a second departing debtor, same-day departures sharing one cutoff, partial payments, insufficient cash, overpayments, stale expense/payment reviews, row-lock races, retry/rollback atomicity, prior-month debt, all-session revocation with a concurrent login, privacy, blocked backdated changes, and month-end closure after departure payments. A calculation regression also covers continuing roommates changing from debtors to creditors after later spending. No live payment, roster change, deactivation, or closure is needed for these checks.

## Expense recording and period rules

- Amounts are decimal strings from validation through prepared SQL parameters and JSON responses. MySQL `DECIMAL(14,2)` and `SUM` provide exact arithmetic. Positive values from 0.01 to 999,999,999,999.99 AFN are accepted, with at most two decimal places; extra precision is rejected instead of rounded. Totals include all nondeleted expenses in the selected month, independent of the 50-row page size. These are spending totals, not settlement balances.
- Dates are validated with pinned `jalaali-js` 1.2.8 and stored as Shamsi `YYYY-MM-DD` strings, alongside a derived `YYYYMM` period key. Selected dates never pass through JavaScript `Date` or timezone conversion. Only the default “today” is computed from the current instant in Asia/Kabul. Afghan month names are used throughout expense forms, filters, and lists. The calendar algorithm supports positive Shamsi years 1–3177; its far-future leap predictions differ from some other calendar implementations.
- The server derives the payer from the session. Personal reads, edits, and deletes always filter by that payer, including when the signed-in person is the admin. Admin review is a separate read-only list with roommate and month filters; it grants no right to edit or delete another payer's expense.
- Descriptions are trimmed and limited to 100 Unicode characters. Categories are Breakfast, Lunch, Dinner, or Other. Deletion marks `deleted_at`; deleted rows and before/after audit snapshots remain in MySQL and are excluded from normal lists and totals. Foreign keys prevent deleting referenced financial history. Audit snapshots retain exact decimal strings, actor, action, version, and timestamps.
- Every create, update, and delete locks the singleton accounting state and relevant period rows inside the same transaction as the expense, audit record, and submission-key record. Both the original and destination months must permit a date change. Settling/closed months are immutable, and a prior tracked month that is not closed blocks entry in a later month for everyone, including the admin. UI warnings reflect these rules; the server checks them again when saving.
- A later month is enabled only by validated closure of its immediate predecessor. Expense requests cannot create missing periods or skip months. Entry also requires explicit participant reconfirmation for the enabled month; every earlier tracked month must remain closed. No obligations or historical records are erased when opening the next month.
- Forms receive random submission UUIDs. The server scopes each key to its authenticated actor and persists a fingerprint plus the original result. Concurrent submissions or retries with the same key and same validated payload return one expense/result and one audit event. Reusing a successful key for a different change returns 409. Failed transactions consume no key. Keys remain stored so older retries cannot create duplicates. Expense version numbers also reject stale edits/deletes with 409.

For an existing local installation, update with:

```powershell
npm.cmd ci
npm.cmd run db:migrate
npm.cmd run period:init -- --year 1405 --month 8
npm.cmd run build
npm.cmd start
```

## Manual verification

1. Sign in as a roommate. Open **Add Expense**: verify Kabul's Shamsi date, Afghan month names, the description counter, and an open-period message. Record 0.10 and 0.20 AFN in Aqrab 1405; **My Expenses** should show 0.30 AFN. Try zero, negative amounts, three decimal places, and an invalid Hoot day; saving must be rejected.
2. Edit an expense, then open its delete page. **Keep expense** cancels; **Confirm deletion** removes it from the history and spending total. An administrator inspecting MySQL should still find the expense row and create/update/delete audit records with before/after values.
3. In separate browser profiles, sign in as another roommate and as admin. Change expense IDs in edit/delete URLs and direct API requests: another payer's record must be unavailable. Altering a personal-list `userId` query does not change its owner. The admin's **Expense review** can filter everyone or one roommate, but offers no edit/delete controls.
4. Use browser network tools to replay the same expense POST, preserving its `requestKey`, body, and session. It must return the existing result without adding a row or audit event. Two tabs editing the same version must not silently overwrite one another. Use **My Expenses** filters to verify empty months and that changing the selection replaces the displayed history.
5. Select Qaws 1405 on the add form while Aqrab remains open. The warning must explain the blocked month and disable submission; a direct POST must also fail. Settle and close Aqrab through **Settlement fund**, then explicitly confirm Qaws participants. Only then should entry unlock. Do not change database statuses manually to bypass validation.

## Participation and allocation previews

An account grants login access; a row in `rems_memberships` establishes room participation. The admin's explicit initial decision creates memberships starting on 1 Aqrab 1405, recorded with the confirming actor and timestamp. Every existing non-deleted expense payer must be included before confirmation, otherwise setup fails clearly. Zero-spending participants must also be selected. The review revision detects changed accounts/expenses before saving, and concurrent or retried confirmation of the same selection creates one roster.

After confirmation, creating another account does not add a historical participant or change shares. A nonparticipant may still sign in and view their own account/history, but receives no guessed balance and cannot record new shared expenses outside confirmed participation. The UI/API cannot add arrivals, record absences, or change the initial roster. Only the explicit departure workflow can establish an inclusive leaving date.

Use **My balance** (`/balances`) or **Room balances** (`/admin/balances`) and select a Shamsi year/month. A roommate receives only their own spending, allocated share, signed initial balance, and **To receive**, **To pay**, or **Balanced** direction. The personal API ignores requested user IDs and never returns other participants, room totals, or per-expense allocations. The admin endpoint returns all participants, including zero-spending members, plus room totals. Open-month allocations are provisional; after settlement begins they are frozen initial balances. Use **My settlements** or **Settlement fund** for actual payments and outstanding balances.

The shared server engine is `src/server/allocation-engine.ts`; the authenticated database service is `src/server/balances.ts`. They use non-deleted expense amounts and confirmed participation on each expense's Shamsi date:

```text
Spending        = personal non-deleted expenses in the selected month
Allocated share = sum of that person's expense allocations
Initial balance = spending - allocated share
```

Positive means money **To receive**; negative means **To pay**. All arithmetic uses BigInt minor units (0.01 AFN). Decimal strings are converted without floating-point arithmetic. Each expense's floor share is distributed equally, then remaining minor units rotate through eligible user IDs in stable order. The rotation continues across expenses for each eligible roster, seeded by the accounting month so the starting person also varies between months. Expenses are processed by Shamsi date and ID. With unchanged membership, cumulative shares differ by at most 0.01 AFN. Every expense is conserved exactly; room allocated shares equal room spending, and initial balances sum to zero.

Open-month previews recalculate after permitted edits and soft deletion, including provisional rounding adjustments. Subsequent months require explicit reconfirmation of eligible continuing members. New accounts are not silently included. Departures require the dedicated reviewed workflow; arrivals and absences remain unsupported. Period guards prevent entry until the preceding month has genuinely closed and the new roster has been confirmed.

### Frozen allocation integrity

The engine accepts inclusive `leavesOn` dates: the leaving person participates on that date and is excluded afterward. Earlier expenses keep the same eligible participants and deterministic allocations. The departure service establishes this cutoff only after explicit admin review and confirmation.

`rems_allocation_freezes` reserves explicit reviewed-through boundaries for departure or month-end allocation freezes. `rems_finalized_expenses` records the reviewed expense version and a fingerprint of its financial source and eligible participant IDs; `rems_finalized_shares` stores every participant's exact minor-unit allocation. The preview service reads these records and never inserts, updates, or overwrites them. It rejects missing snapshots inside frozen ranges, altered expenses or historical participants, incomplete/inconsistent saved shares, and unsupported algorithms. Settling/closed periods require a complete month-end snapshot; they are never silently recalculated from current accounts.

Expense mutations lock the accounting singleton and period rows, then reject additions, edits, date moves, or deletions on/before any saved freeze boundary in the same transaction as the expense/audit write. This also protects dates with no earlier expense. Monthly settlement acquires that same singleton, saves complete boundaries/source fingerprints/shares and initial balances atomically, and transitions the period to settling. Departure finalization uses the same lock and snapshot protections, while leaving subsequent dates open for continuing roommates.

For existing installations, run `npm.cmd run db:migrate`, rebuild/restart, and confirm the roster through **Participation**. Do not repeat initial period setup for a different month or edit database participation/freeze data manually.

### Manual balance verification

1. Before roster confirmation, open both preview pages and verify **Roommates must be confirmed** and no numeric guesses. In **Participation**, include every resident, including those with no spending, and explicitly confirm the review screen.
2. In a fresh test setup with two participants spending 2,000 and 1,000 AFN, verify shares of 1,500 each and initial balances **To receive 500** / **To pay 500**. The automated engine test covers this example without changing the local historical roster.
3. For five participants spending 2,000 / 1,000 / 500 / 1,000 / 3,000 AFN, verify 1,500 shares and initial balances +500 / -500 / -1,000 / -500 / +1,500. Include a zero-spending participant in another test selection and verify they still receive an allocated share.
4. Edit or delete a permitted open-month expense and reload the previews. Confirm exact room totals and balanced initial-balance totals. Several 0.01 AFN expenses should distribute rounding differences rather than always charging the first roommate.
5. As a roommate, request `/api/balances?year=1405&month=8&userId=another-id`; only the session user's figures may appear. `/api/admin/balances` and `/api/admin/participation` must reject roommate access. Creating another account must leave the confirmed room totals/shares unchanged.

## Settlement fund and validated closure

Admin workflow: open **Settlement fund**, select the Shamsi month, review every participant's spending/share/initial balance and the room totals, check the review confirmation, then **Begin settlement**. The server recomputes the review fingerprint while holding the same accounting lock used by expense writes. A stale review returns 409 and requires a new review. Allocation snapshots, frozen initial balances, the lifecycle transition, and the retry record commit together. Expenses and roster changes are blocked once settling begins. Repeated begin requests preserve the original snapshot and actor/timestamp.

**Collect from roommates** lists negative outstanding balances; **Pay roommates** lists positive ones. The admin enters a positive AFN amount, actual Hijri Shamsi payment date, and optional note (200 characters maximum), then explicitly confirms that the money was really received or paid. Partial payments are supported. Real dates are required and future payment dates relative to today in Kabul are rejected. Payment dates can differ from the accounting month, since actual settlement may occur later. Recording timestamps are read in UTC and displayed in Shamsi with Kabul time. There are no automatically confirmed or generated payments.

```text
Initial balance     = spending - allocated share
Outstanding balance = initial balance + confirmed collections - confirmed payouts
Fund cash held      = confirmed collections - confirmed payouts
```

Collections move a debtor's negative outstanding balance toward zero; payouts move a creditor's positive balance toward zero. Wrong-direction payments, overcollection, overpayment, and payouts exceeding cash held are rejected. The admin's own personal contribution or reimbursement uses exactly the same participant ledger rules. Holding room-fund cash is distinct from the admin's personal expense share.

Every payment records its participant, month, direction, positive exact-decimal amount, actual Shamsi date, note, recording admin, and timestamp. Confirmed ledger rows have no edit/delete endpoint. **Correct an erroneous record** requires a reason and explicit correction acknowledgement, appends one linked reversal, and leaves the original row unchanged. The reversal uses the original payment's participant/direction/amount/date and its own recording admin/timestamp. It corrects the ledger's representation of an erroneous record; it does not record another real payment, perform a bank transfer, or refund physical money. If reversing a receipt would make fund cash negative, dependent erroneous payouts must be corrected first. Reversal entries cannot themselves be reversed; duplicate reversals are rejected. To replace an erroneous payment with a correct one, reverse the erroneous entry when valid and record the actual correct payment separately.

All settlement mutations require an authenticated admin, trusted Origin, explicit acknowledgement, and a UUID retry key. The singleton accounting row, month row, frozen balances, and existing ledger rows are locked during writes. Exact BigInt arithmetic checks participant bounds, cash availability throughout ledger history, and the invariant `sum(outstanding balances) = fund cash held`. Persistent actor-scoped retry keys store payload fingerprints and results in the same transaction, so retries cannot create duplicate receipts, payouts, reversals, or snapshots. Reusing a successful key for another payload is rejected. Database failure rolls back both the financial mutation and its retry record.

**My settlements** returns only the session user's initial balance, net confirmed collections/payouts, outstanding direction/amount, and their own ledger history. Request parameters cannot change the owner. Room totals, the room cash balance, other participants, and the settlement review fingerprint appear only in admin responses. Color is accompanied by textual labels.

**Validate and close month** is enabled when every participant and fund cash show zero. The server independently requires settling status, revalidates the original allocation sources and frozen balances, validates the complete ledger, and checks all participant outstanding amounts and fund cash equal exactly 0.00 AFN. It writes the closure actor/timestamp and enables only the immediately following Shamsi month atomically against payment requests. No force-close or mark-as-paid action exists. Retries preserve the closure timestamp and do not create additional periods. Closed expenses, participation, allocations, and ledger records remain read-only.

The new month has no old ledger entries or settlement cash because the preceding month was genuinely settled. It requires admin reconfirmation through **Participation**, selecting all eligible continuing members. Finalized departures are excluded after their leaving date; adding arrivals or recording absences through this screen is rejected. Prior records remain available by Shamsi month. Skipping to a later month is blocked.

For an existing installation:

```powershell
npm.cmd ci
npm.cmd run db:migrate
npm.cmd run build
npm.cmd start
```

Do not repeat initial admin or first-period setup. Migrations preserve existing accounts, sessions, expenses, participation, and finalized allocations. No live settlement or actual payment is generated by migration. Legacy externally finalized months with no matching settlement metadata fail clearly and require recovery review; they are not silently adopted, overwritten, or marked paid.

### Manual settlement verification

Use the disposable automated fixtures for example payments; on the real room ledger, confirm only money actually received or paid.

For a read-only review of the local screen, run `npm.cmd run dev`, sign in as admin, and open http://localhost:3000/admin/settlements?year=1405&month=8. Inspect the spending, shares, initial balances, fund cash, and payment history. If the real roster is still unconfirmed, the expected screen says **Roommates must be confirmed**. Viewing this page does not begin settlement or record payments; leave **Begin settlement**, payment/reversal actions, and **Validate and close month** unused when reviewing only.

1. For spending A/B/C/D/E = 2,000 / 1,000 / 500 / 1,000 / 3,000 AFN, verify spending/shares total 7,500, each share 1,500, and initial balances +500 / -500 / -1,000 / -500 / +1,500. Review and begin settlement. Expense edits/deletion/new entries must now fail.
2. Record B's receipt of 500 (or partial receipts totaling 500), C's receipt of 1,000, and D's receipt of 500. Verify cash held is 2,000. Record payouts of 500 to A and 1,500 to E; all outstanding balances and cash must become zero. Expense totals must remain 7,500 throughout.
3. Verify an early payout cannot exceed actual cash held, a payment cannot exceed that participant's outstanding amount, and wrong directions are rejected. Replaying a successful POST with its original retry key/body must return the same result without adding a ledger row.
4. In a test fixture, correct an erroneous receipt/payout with a reason. Verify the original remains visible, the linked reversal changes the net totals, and attempting to reverse twice fails. A receipt reversal after its cash has been distributed must fail until dependent erroneous payouts are corrected.
5. As a roommate, check only personal payments and balances appear. Changing `userId` in `/api/settlements` must not retrieve another person; admin settlement reads/writes must return 403. Closed-month payment and reversal requests must fail.
6. Attempt premature closure and verify rejection. After actual payment completion, close and repeat the same request: the month remains closed with one closure timestamp and one next period. Confirm the next month's unchanged continuing roster explicitly, then enter new-month expenses. Earlier expenses/payments remain unchanged, and another month further ahead stays blocked.

This application records confirmations; it does not move money or integrate with a payment provider. Account deletion, automatic reactivation, and arrival/absence policies remain unsupported.

## Departure settlement and deactivation

1. As admin, open **Departures** (`/admin/departures`), select a participating roommate and a real Shamsi leaving date, then **Review departure**. The date is inclusive. Review their expenses, per-expense allocations, spending, share, earlier confirmed payments, remaining balance, fund cash, and earlier tracked obligations. This GET is read-only. The sole admin cannot depart through this workflow.
2. Resolve any reported conflicts first. Settling/closed periods, dates preceding an existing frozen cutoff, conflicting later confirmed rosters, or the departing person's later nondeleted expenses are rejected. The app never discards those records. Permitted expense corrections require their owner; choose the correct leaving date if later spending is legitimate. Later expenses by other roommates remain recorded and provisional, and the review explains their changed eligibility.
3. Explicitly confirm that every expense through the leaving date is complete, then **Finalize departure cutoff**. The shared accounting transaction lock serializes this operation against expenses, payments, roster confirmation, and monthly settlement. A changed review is rejected. The transaction preserves existing allocation snapshots, freezes any newly covered expenses and cutoff balances, records the actor/time/source digest, and sets the membership's inclusive leaving date. Retrying creates one result. All new/backdated expense entries, edits, deletions, and unsupported roster changes affecting that frozen range are blocked. The month stays open; remaining roommates can continue after the cutoff.
4. Follow **Record actual collections and payouts through the room fund**. During an open month, the fund screen explicitly identifies the latest reviewed departure cutoff. Collect only actual amounts owed through that cutoff, including from continuing roommates when necessary to fund a departure payout. Partial payments, persistent retry keys, exact minor-unit arithmetic, direction/overpayment checks, and available-cash checks apply as at month end. A second departure requires a fresh review and can extend the cutoff; multiple departures on the same date share its snapshot.
5. **Deactivate settled account** becomes available only after the departure is finalized, its outstanding balance is exactly zero, and earlier tracked obligations are verified and zero. The server rechecks these conditions under transaction locks, marks the account inactive with actor/time, and invalidates every session atomically. A concurrent password login cannot leave a usable session. Positive and negative balances both block deactivation; no payment is generated. The fund may still hold money for others. Retrying preserves the original deactivation and history.
6. At month end, review the separate **Full month-end review**, including subsequent expenses and previous cutoff payments. Beginning settlement freezes the full month without resetting or duplicating earlier payments. Each payment retains its original reviewed basis, while outstanding balances use all confirmed net collections/payouts. Departed participants stay in that month's history at zero; remaining participants settle the rest. Closure still requires every balance and fund cash to be exactly zero, then the next roster requires explicit confirmation.

Ordinary reversals are rejected for payments belonging to any finalized departing roommate, including their earlier tracked months, so they cannot reopen protected balances. Erroneous entries for continuing participants still require a reason and must leave all ledger/cash invariants valid. Recovery of conflicting historical data or correction of a finalized departure requires a separate reviewed recovery workflow, which is not implemented; there is no override, date rewrite, hard deletion, or automatic reactivation endpoint.

For safe local manual review, run `npm.cmd run db:migrate`, then `npm.cmd run dev`, sign in as admin, and open http://localhost:3000/admin/departures. Select a roommate/date and click **Review departure** only. Open http://localhost:3000/admin/settlements?year=1405&month=8 to inspect the existing fund. Leave finalization, payment, deactivation, and closure actions unused on the live ledger unless they represent an authorized real event. Use `npm.cmd test` for the complete disposable departure scenario, including the 500 AFN payout and later 250 AFN shares.

## Monthly A4 reports and Word downloads

Run `npm.cmd ci` to install the locked dependencies, then `npm.cmd run build` and `npm.cmd start` (or `npm.cmd run dev`). Reports require no additional migration: milestone 6 does not modify financial tables, accounts, participation, or accounting periods. Word documents are generated server-side with pinned **docx 9.15.4**; Word or LibreOffice is not required on the application server.

- `/reports` and `/api/reports` return only the signed-in person's report. Other user IDs and room-wide requests are rejected. The admin's `/admin/reports` and `/api/admin/reports` support room and individual selection, including zero-spending participants and historical/deactivated roommates relevant to the month. Nonparticipants have unavailable shares/balances, rather than guessed zeros.
- `/api/admin/reports/word` checks admin permission again and generates a real OOXML ZIP document with editable paragraphs and tables, not HTML or an image. Its filename identifies the report type, person where applicable, and Shamsi period. Text remains Unicode; XML-forbidden control characters are displayed as replacement glyphs consistently in preview and Word. The existing account username policy remains unchanged.
- Every report uses one read-only repeatable-read MySQL transaction. `src/server/reports.ts` reads the selected month's nondeleted expenses and reuses `readMonth`'s authoritative full-month allocations and ledger. Open-month figures are provisional, preserving finalized departure shares; they include permitted subsequent expenses, rather than stopping at the departure fund's payment cutoff. Settling/closed reports validate and consume the existing frozen allocations. No second allocation or settlement calculation engine was added.
- Personal reports contain spending, actual allocated share, initial direction/amount, net confirmed collections/payouts, outstanding direction/amount, leaving date where applicable, and a compact payment history retaining original/reversal references. Room reports contain all selected-month expenses, payers, every historical participant, and separate fund collections, distributions, and cash. A reversal changes net payment totals once; departure payments are not recreated at month end.
- Without confirmed participation, actual expense spending is shown but shares and balances explicitly remain unavailable. Unsafe finalized sources or ledger state produce a clear error rather than a plausible-looking report. Empty months show an empty table; selection never deletes historical records.
- The preview and Word export share `src/lib/report-document.ts` for titles, status, notes, table labels, records, and financial summaries. Downloads from the preview include its snapshot fingerprint. If the report changes before download, the server returns 409 and requests a fresh review. Both data and download endpoints use `private, no-store`, vary by Cookie, and validate each request; report pages are dynamic. Files are generated in memory without public temporary files or document links that bypass login.
- The on-screen document has A4 portrait width; long months flow continuously for reading. Browser print preview creates actual A4 pages with repeated expense headings, protected rows/summary headings, and page numbers in browsers supporting CSS page-margin boxes. Word declares A4 portrait, 18 mm margins, fixed readable table widths, repeating header rows, unsplit rows, heading keep-with-next, and real PAGE/NUMPAGES fields. Additional pages are allowed rather than scaling an entire month down.

### Read-only manual report review

1. As admin, open http://localhost:3000/admin/reports?scope=room&year=1405&month=8. Inspect the status, selected-month expenses, participant summary, and separate fund totals. If the live roster is unconfirmed, the expected report says **Roommates must be confirmed**; do not confirm a roster just to preview a report.
2. Choose **Individual Person**, select a historical roommate, and view the report. Verify personal spending, actual share, payments, remaining direction, and leaving date. Download the `.docx` and open it in Word or LibreOffice; text and tables must remain editable. Refresh the preview if a concurrent change makes its download stale.
3. In another browser profile, sign in as a roommate and open `/reports`. Only that person's information appears and no Word download button is present. Requests to admin report/download endpoints return 403, including manipulated person IDs. Anonymous pages redirect to login and APIs return 401.
4. Use **Print A4 preview** for pagination. Selection controls/navigation/download buttons must disappear from the printed document. Large tables continue onto additional pages; headings repeat and amounts remain aligned. Browser support determines whether CSS footer page numbers are available; Word has native page-number fields.

### Automated and visual report verification

`npm.cmd test` includes isolated report fixtures for permissions/cache privacy, month boundaries, zero-spending and unconfirmed participants, provisional/frozen/closed/departed states, concurrent snapshot reads, partial payments and reversals, actual departure payouts counted once, stale downloads, matching preview/Word table data, Unicode, XML-safe text, full ZIP/XML structure, A4 settings, and large months exceeding expense-history pagination.

The browser subtest uses pinned Playwright 1.65.1 with installed Chrome on this Windows machine. Elsewhere, set `REMS_REPORT_BROWSER_CHANNEL` to an installed supported channel (`chrome`, `msedge`, or `chromium`); Chromium requires `npx playwright install chromium`. Without an available configured browser, that visual subtest explicitly skips while data/OOXML tests still run. The complete suite requires a current production build and disposable-database privileges as described above.

Milestone 6 verification: **89 tests passed, zero failed or skipped**. Lint, type checking, and the production build passed. Read-only comparisons confirmed live financial/participation data stayed unchanged and no live departure or account deactivation was created. No migration was needed or applied for reports; no deployment was performed.

Visual fixtures contain 83 expenses, long Unicode descriptions, a departed participant, and partial/reversed payments. Generated samples and screenshots are kept only in ignored `.cache/report-verification/`: `room-multipage.docx`, `browser-multipage.pdf`, `word-multipage.pdf`, and desktop/mobile PNGs. The browser A4 sample was visually inspected across seven pages, including repeated headings, page numbers, and the final summary. The downloaded DOCX was independently rendered with pinned docx-preview 0.4.1 and Chrome and inspected across six A4 pages. Native Microsoft Word automation stalled in this environment; its exact layout was not verified. The independent renderer does not reproduce Word's repeating headings on automatically printed continuation pages and has approximate pagination/field handling. Check final Word page breaks and field updates in the user's editor. The DOCX's native A4, repeated-row, keep-with-next, PAGE/NUMPAGES, and update-fields settings are verified structurally. No real room data is used by these fixture renders.

## Official documentation used

Implementation follows the version-matched Next.js guides bundled in `node_modules/next/dist/docs/` (authentication, Cache Components authentication, cookies, Route Handlers, and environment variables), plus:

- [Next.js 16.4.6 authentication guide](https://nextjs.org/docs/app/guides/authentication)
- [mysql2 official Promise API and prepared statements](https://sidorares.github.io/node-mysql2/docs), checked against installed 3.24.6 declarations and the [3.24.6 release](https://github.com/sidorares/node-mysql2/releases/tag/v3.24.6)
- [Node.js 22.15.0 crypto APIs](https://nodejs.org/download/release/v22.15.0/docs/api/crypto.html)
- [MySQL 8.0 implicit DDL commits](https://dev.mysql.com/doc/refman/8.0/en/implicit-commit.html) and [advisory locks](https://dev.mysql.com/doc/refman/8.0/en/locking-functions.html)
- Installed Next.js 16.4.6 Route Handlers, dynamic route segments, and form guides in `node_modules/next/dist/docs/`
- [jalaali-js official calendar API](https://github.com/jalaali/jalaali-js), checked against the installed 1.2.8 README and declarations
- [MySQL 8.0 exact decimal types](https://dev.mysql.com/doc/refman/8.0/en/fixed-point-types.html) and [transaction locking reads](https://dev.mysql.com/doc/refman/8.0/en/innodb-locking-reads.html)
- [docx Packer / genuine OOXML export](https://docx.js.org/api/classes/index.Packer.html), with installed 9.15.4 declarations for page sizes, repeated table headers, row splitting, headings, and page fields
- [Playwright browser channels](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-option-channel), checked against installed 1.65.1
- [docx-preview rendering API and pagination limitations](https://github.com/VolodymyrBaydalka/docxjs), checked against installed 0.4.1; this is a development-only independent visual check
