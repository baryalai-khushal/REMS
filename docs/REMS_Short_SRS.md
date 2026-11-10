# REMS — Short SRS (Draft v3)

## 1. Purpose and scope
REMS (Room Expense Management System) is a private web application for our room in Kabul. It records shared expenses, divides monthly costs equally, manages settlement through the admin, and produces monthly reports. It supports one room only.

## 2. Technology
Next.js, TypeScript, Tailwind CSS, and MySQL. Host the complete application and database on the existing Contabo VPS.

## 3. Users and access
- One admin creates accounts, manages roommates, resets passwords, and accesses all reports.
- Each user has a unique username and an eight-character password, stored securely as a hash.
- Users add, view, edit, and delete their own expenses while the month is open. They see only their own personal reports.
- Removing a user deactivates the account while preserving expenses, settlements, and reports. Deactivation is blocked until the roommate has a confirmed zero balance through their leaving date, whether they owe money or are owed money.

## 4. Expense recording
Each expense records the payer, positive amount in AFN, Hijri Shamsi date, category (breakfast, lunch, dinner, or other), and a description of at most 100 characters. Keep an audit history of edits and deletions.

## 5. Equal monthly shares
- If membership stays unchanged, monthly share = total shared expenses ÷ participating roommates.
- For a mid-month departure, divide each expense equally among the roommates participating on its expense date; each person's monthly share is the sum of those allocations. Never recalculate earlier expenses using only the remaining roommates.
- Initial balance = personal spending − monthly share.
- Positive balance: money to receive from the room fund.
- Negative balance: money to pay into the room fund.
- Settlement payments are separate from expenses and never increase expense totals.
- Use exact monetary arithmetic and distribute rounding differences so shares equal the exact total.

## 6. Leaving the room and deactivation
- The admin selects the leaving date in Hijri Shamsi. The roommate participates through that date, inclusive, and is excluded from expenses after it.
- Finalize expenses through the leaving date and calculate spending, allocated share, earlier settlements, and the remaining balance.
- If the roommate owes money, the admin must collect it. If the roommate is owed money, the admin must pay it from the room fund. Do not clear either balance without an actual confirmed payment.
- Permit deactivation only when the remaining balance is exactly zero; enforce this on the server. Preserve the settled allocations and financial history. Do not silently alter a departed user's settled share through backdated edits or new entries.
- A departure settlement does not close the entire month. Remaining roommates continue recording later expenses, divided among themselves. The room report retains everyone who participated during that month.

Example: Through 20 Hamal, five roommates have shared expenses of 7,500 AFN. User 1 spent 2,000 AFN and their share is 1,500 AFN. The admin must pay them 500 AFN before deactivation. Expenses from 21 Hamal onward are divided among the remaining four; earlier expenses stay divided among five.

## 7. Admin-managed settlement
Roommates settle with the admin through a central room fund rather than paying one another directly.
- The admin records money collected from each debtor and money paid to each creditor.
- Each record includes the roommate, direction (collection or payout), amount, Shamsi date, and admin confirmation.
- Confirm only money actually received or paid. Support partial payments, calculate the remaining amount, and prevent overpayment.
- Track fund cash separately: confirmed collections minus confirmed payouts.
- The admin's own expense share follows the same rules; room-fund cash is separate from the admin's personal balance.

Example: A/B/C/D/E spend 2,000/1,000/500/1,000/3,000 AFN. Total = 7,500 AFN; each share = 1,500 AFN. Collect 500 from B, 1,000 from C, and 500 from D. Pay 500 to A and 1,500 to E.

## 8. Month closure and entry blocking
The admin reviews totals before month-end settlement; freeze expense changes once month-end settlement begins to preserve the reviewed calculation. Departure settlements instead preserve the allocations through the leaving date and allow subsequent expenses for the remaining roommates.

Close the month only when all participating roommate balances, including departed roommates, are zero and all collected settlement money has been distributed. Closed expenses and settlements are read-only.

If the previous month is unsettled or unclosed, block all new-month expense entries, including admin entries, on both the interface and server. Keep login, reports, and settlement recording available. Unlock entry after closure; never erase debts through an automatic reset.

## 9. Monthly report interface
- Normal user: choose Shamsi year and month, then view only their personal report.
- Admin: choose Entire Room or Individual Person; select a roommate for an individual report; choose year and month.
- Display only the selected month's report. Changing the selection replaces the displayed report without deleting saved history.
- Show a clean A4-style document with report title, selected period, roommate name where applicable, table, totals, settlement summary, status, and page numbers.
- Personal table: row number, Shamsi date, category, description, and amount in AFN.
- Personal summary: spending, equal share, amount owed or receivable, confirmed collections/payouts, and remaining balance.
- Entire-room report: all expenses with an additional Paid by column, room totals, and a settlement summary for every roommate.
- Keep report-selection controls outside the printable page. Allow additional A4 pages when necessary, repeat table headers, and keep every page within the selected month.
- The admin can download the selected report as a Word (.docx) document.

## 10. Calendar, reliability, and recovery
Use Hijri Shamsi dates and monthly periods throughout the interface and reports, with Kabul local time. Support phones and computers, enforce permissions on the server, prevent duplicate submissions, and automatically back up MySQL daily outside the VPS.

## 11. Rules still to confirm
Before implementation, define how mid-month arrivals and temporary absences affect participation and equal shares. The departure rule above is confirmed.
