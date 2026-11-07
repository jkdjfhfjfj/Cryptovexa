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
| Support and content | Help search, article categories/order, related articles, helpful votes, tickets, staff replies/internal notes, assignment and canned replies; announcements, legal text, translations and email-template editing. Visual/source rich-text authoring now exists for articles and legal pages, with link/image validation and client/server sanitization. Email templates are explicitly source-only; raw previews are sandboxed. |
| Email and alerts | Branded HTML, localized template selection, retry/backoff and interrupted-send recovery. Per-event administrator recipient routing and queued Telegram alerts are connected. Optional receipt preferences are respected; security/recovery messages remain mandatory. Live SMTP/Telegram delivery remains unverified. |
| Logs/reports | Financial exports, ledger reconciliation, staff audit/login/email/worker/error records, and a credential-redacted data export. The export is not a substitute for a restorable database-and-object-storage backup. |
| Branding/PWA | Original hexagon/V/dot geometry and teal/emerald defaults, Sora typography, branded splash/loading states, favicon, 192/512/maskable PNGs, dynamic manifest, theme and brand overrides. Private API responses are excluded from the offline cache. |

## Verification

- **24 automated regressions pass**, including concurrent billing/renewal/stop workers, billing-boundary idempotency, saved-request replay, overbooking, double spending and rollback-isolated simulated mail retries.
- **13 HTTP integration checks pass**, covering actual workspace SQL, all staff roles, private uploads/downloads and audit records, KYC decisions, CSRF/origin denial, required financial request identifiers, force-stop audit reasons, concurrent rental request replay, and manual-only withdrawal rejection/replay with a single unlock.
- The deposit-approval and withdrawal-settlement services are tested for repeated calls.
- Date assertions now cover rental start and deposit acceptance timestamps. This caught a schema-helper mismatch that transaction-only tests had missed.
- User and API TypeScript checks pass.
- A frontend production build succeeds. Non-blocking bundler warnings remain about bundle size and third-party source maps.
- Public branding, favicon/icon HTTP responses and actual PNG dimensions were checked.
- A small real App Storage upload was verified byte-for-byte, denied to finance, allowed to the owner/reviewer and then deleted.
- Signed-in browser test results are recorded below after the test run.

## Still incomplete or not proven

- Complete translation of every user/admin string into all eight requested languages. Language selection, shared translations and Arabic RTL exist, but many page-specific strings remain English. A notice in the selected language now explicitly labels partial coverage.
- The new visual rich-text editor typechecks/builds but its formatting, selection, paste, source switching and round-trip editing have not yet received a browser walkthrough. It supports a bounded HTML subset, not arbitrary word-processor/email markup.
- General-purpose bulk administrative actions and dedicated category-management workflows are not comprehensive.
- A complete installed-device/offline PWA test, comprehensive accessibility review and long-running load/failure testing have not been performed.
- Real Binance, SMTP, Turnstile and Telegram integrations require operator configuration and controlled validation. No financial transfer may be initiated without explicit authorization.
- Legal text remains a draft. The operator confirmed **virtual rentals inside the app**, not real property/hardware access. The UI, confirmation acknowledgement and new-rental metadata/notifications now reflect this model. Real-world provisioning is outside the confirmed scope.

## Current hardening and launch review

- Help categories now scroll inside a bounded grid column rather than expanding the mobile document; long article/ticket content wraps and wide article tables/code blocks scroll locally.
- Mail retry claiming now rechecks backoff/attempt limits atomically; simulated delivery tests verify preserved reset-link payload, backoff and no repeat after success. Manual resend clears stale delay metadata.
- SMTP always requires encryption: implicit TLS on 465 and STARTTLS otherwise. The misleading optional TLS toggle was removed. Actual external delivery remains unverified.
- Verification/reset link requests are checked against the application origin; an attacker-controlled Origin cannot queue a reset email. Published-origin delivery remains a live validation gate.
- CAPTCHA enforcement, referral suspicion review/manual allow/block, recipient routing and queued Telegram behavior are implemented in source, not merely saved settings. Their real provider behavior is not certified without configured operator credentials.
- No encrypted provider credentials were present at review. Production `ADMIN_EMAIL` and secret `ADMIN_PASSWORD` were absent; `SESSION_SECRET` was present. No secret values were inspected.
- No published deployment exists. Publication is blocked on operator configuration, country-specific legal/provider eligibility, backups/security review and explicitly authorized live financial validation. The intended audience “all countries” is not a legal-availability claim.

## Extended development-only walkthrough

- Fresh customer and staff registration were exercised through the UI; the generated staff account then signed in normally in the administrator realm.
- Customer TOTP enrollment succeeded; an incorrect authenticator code was denied and a fresh correct code signed in.
- A real synthetic selfie PNG was uploaded through the KYC file chooser, submitted, privately viewed/audited and approved by staff. The unauthenticated document request was denied.
- Help search/category interaction and article pages stayed within the document at both 320px and 390px. The narrow-screen feedback prompt subsequently received a full-width row, confirmed by a fresh screenshot.
- The stale approved-KYC withdrawal warning was corrected to depend on the current request/account status. The existing HTTP review test confirms the underlying account block is cleared when appropriate.
- Real proof bytes were uploaded in an HTTP integration check. Finance was denied the unassigned upload, then permitted to view it after it was associated with a test-only deposit proof. KYC finance denial remains a separate passing check.
- The first extended browser pass deliberately stopped before withdrawal creation, because using the normal user API would create a queued transfer. A guarded CLI now seeds `manual_fallback` directly and marks it test-only; approval/retry/settlement are forbidden for those records and automatic submission excludes them.
- QA credentials exist only in a mode-0600 temporary file during that continuation, never in source, logs or this report.

The focused continuation completed:

- Normal customer/staff login with generated fixture passwords; no injected sessions.
- Customer wallet showed 20 USDT, 11 locked and 9 available.
- Administrator rejected the 10 USDT + 1 fee fixture through the UI. Wallet returned to 20/0, with one zero-amount rejection ledger entry. Repeated rejection returned HTTP 400 without an extra unlock.
- Reports reconciliation showed Balanced. Withdrawals and ledger CSV downloads were inspected and contained the expected fixture entries.
- The virtual-rental acknowledgement was checked and the sheet closed without confirming. No rental was created.
- Owned users, sessions, records, reconciliation data, files and temporary credentials were cleaned up; no operator settings or other accounts were changed.

That continuation found delayed post-login UI refresh and misleading transfer controls on test-only rows. The UI now disables those controls, publishes server-confirmed auth identity before navigating, cancels stale guest responses, and keeps actions pending through cache refresh.

The final targeted check passed in fresh, separate contexts: customer login reached the signed-in home page and admin login reached `/admin/dashboard`, both without reload or manual navigation. The test-only drawer showed its warning, disabled Mark sent/Retry and kept Reject available. Fixture cleanup succeeded and contexts were closed. No financial actions were repeated in this final check.

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
