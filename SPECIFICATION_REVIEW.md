# MyCryptoVexa specification review

Reviewed against the complete builder specification and MCV Logo Kit supplied in `attached_assets/`.

## Overall result

The principal user and staff modules exist, but this is **not a certification that every sentence of the specification is complete or production-safe**. Implemented behavior, automated checks, browser checks, and external-service validation are separate claims.

## Coverage and corrections

| Specification area | Current coverage |
| --- | --- |
| Account and security | Password registration/recovery, separate administrator sessions, lockout, TOTP/recovery codes, session revocation, read-only API keys and IP restrictions. Turnstile client/server enforcement is now connected; real provider configuration has not been exercised. |
| Administrative access | Role-restricted actions and navigation, audit records, and a required-2FA enrollment gate before staff workspace data is returned. |
| Wallet and ledger | Decimal-string inputs, SQL NUMERIC arithmetic, wallet locks, idempotent credit/debit/settlement, request UUID enforcement on financial actions, history and exports. |
| Deposits | Manual approval, adjusted credit, rejection/information requests, proof ownership, primary/fallback selection and memo snapshots. Duplicate hexadecimal TXIDs are normalized before checks. Operator-owned receiving addresses are deliberately not invented. |
| Withdrawals | Reserved funds, confirmation, limits, cooldown, blacklist/KYC checks, automatic processing and manual fallback. Ambiguous Binance outcomes require an explicit history check before a retry, manual sending or refund. Confirmed Binance failures release the reserve. No live withdrawal has been validated. |
| Assets and rates | Asset editor, units, images, categories/specifications, three billing modes, discounts and scheduled changes. Invalid pricing JSON no longer disappears silently; inactive status now matches the API. |
| Billing | Fixed missed final-minute charges, prepaid resume charging, grace expiry, staff pause/resume, minimum-charge credit, and refund currency snapshots. Existing reservations use their saved rates. |
| Referrals | Canonical percentages and multiple triggers, cumulative per-beneficiary/per-source-user/per-currency caps, suspicious referral holds and explicit review, idempotent commissions. |
| KYC | Requested items, deadline, private upload references, per-document review and overall approval/re-upload. Decisions cannot overwrite file identities. Superseded requests no longer create permanent withdrawal holds. |
| Support and content | Help search, article categories/order, related articles, helpful votes, tickets, staff replies/internal notes, assignment and canned replies; announcements, legal text, translations and email-template editing. Raw admin HTML previews are sandboxed. |
| Email and alerts | Branded HTML, localized template selection, retry/backoff and interrupted-send recovery. Per-event administrator recipient routing and queued Telegram alerts are connected. Optional receipt preferences are respected; security/recovery messages remain mandatory. Live SMTP/Telegram delivery remains unverified. |
| Logs/reports | Financial exports, ledger reconciliation, staff audit/login/email/worker/error records, and a credential-redacted data export. The export is not a substitute for a restorable database-and-object-storage backup. |
| Branding/PWA | Original hexagon/V/dot geometry and teal/emerald defaults, Sora typography, branded splash/loading states, favicon, 192/512/maskable PNGs, dynamic manifest, theme and brand overrides. Private API responses are excluded from the offline cache. |

## Verification

- **18 automated regressions pass**, including real database concurrency checks against isolated fixtures for overbooking and double spending.
- **10 HTTP integration checks pass**, covering actual workspace SQL, all staff roles, private uploads/downloads and audit records, KYC decisions, CSRF, required financial request identifiers and force-stop audit reasons.
- The deposit-approval and withdrawal-settlement services are tested for repeated calls.
- Date assertions now cover rental start and deposit acceptance timestamps. This caught a schema-helper mismatch that transaction-only tests had missed.
- User and API TypeScript checks pass.
- A frontend production build succeeds. Non-blocking bundler warnings remain about bundle size and third-party source maps.
- Public branding, favicon/icon HTTP responses and actual PNG dimensions were checked.
- A small real App Storage upload was verified byte-for-byte, denied to finance, allowed to the owner/reviewer and then deleted.
- Signed-in browser test results are recorded below after the test run.

## Still incomplete or not proven

- Complete translation of every user/admin string into all eight requested languages. Language selection, shared translations and Arabic RTL exist, but many page-specific strings remain English.
- Visual rich-text authoring: current content editing accepts sanitized HTML/source text, rather than a complete visual rich-text editor.
- General-purpose bulk administrative actions and dedicated category-management workflows are not comprehensive.
- A complete installed-device/offline PWA test, comprehensive accessibility review and long-running load/failure testing have not been performed.
- Real Binance, SMTP, Turnstile and Telegram integrations require operator configuration and controlled validation. No financial transfer may be initiated without explicit authorization.
- Legal text remains a draft, and real-world property access/machine provisioning remains an operator responsibility.

## Signed-in browser results

The targeted administrator/customer journey completed after the schema correction:

- Administrator and customer sign-in; separate cookies cannot substitute for the other realm.
- Manual test deposit approved in the real admin UI; a repeated approval left exactly one credit.
- Customer wallet persisted the credit after reload.
- Hourly rental confirmation, snapshotted rate, wallet debit and capacity reservation.
- PDF invoice download returned a valid PDF response.
- Staff pause persisted after reload; resume preserved the remaining prepaid time without a second debit.
- Force stop restored capacity and produced a refund that reconciled with the customer's ledger and wallet.
- Missing/invalid CSRF and customer attempts to use administrator endpoints were denied without changing funds.

The tester reported no reason field on the original Force stop prompt. That field and a backend reason requirement were subsequently added; the exact HTTP action and audit reason were verified by regression test rather than launching another browser pass.

A brief stale/empty rental count was observed after submission before the workspace refreshed. Persisted rental/payment data was correct, and subsequent reads/reloads showed it. Do not describe the current polling UI as instantaneous realtime.

The two browser QA accounts and their isolated deposit, rental, asset, sessions and financial records were removed after verification. The private upload fixture was also deleted. No real transfers or operator settings were changed.
