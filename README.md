# MyCryptoVexa

Crypto-funded, time-billed **virtual rentals inside the app**. Catalog properties/machines are virtual items; a fee does not grant physical access, computing hardware access or investment returns. Includes a React user application at `/`, an administrative console at `/admin`, and an Express API at `/api`.

## Run locally

Use the existing **API Server** and **MyCryptoVexa web** workflows. The API requires PostgreSQL and `SESSION_SECRET`. The application uses secure HTTP-only cookies through the HTTPS preview.

```sh
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck
pnpm --filter @workspace/api-server run test:finance
pnpm --filter @workspace/api-server exec tsx --test src/tests/api.test.ts
```

The private development preview supports first-administrator setup at `/admin/login` only while no administrator exists. There are no default passwords. User accounts and administrator sessions have separate cookie scopes. In production, set `ADMIN_EMAIL` and the secret `ADMIN_PASSWORD` (at least 12 characters) to bootstrap the initial superadmin.

## Required configuration before accepting funds

1. Set a strong, stable `SESSION_SECRET` in project Secrets. This is used to derive separate encryption keys. Do not rotate it without a coordinated encrypted-settings migration.
2. In **Admin → Settings**, enter SMTP details and send a real test email. Verify sender-domain SPF/DKIM independently.
3. Configure your own deposit address for each enabled currency/network. No usable deposit addresses are invented or seeded.
4. Configure Binance credentials with IP restrictions and withdrawal permission only if needed. Manual mode is enabled by default.
5. Test with tiny real deposits and withdrawals. Verify blockchain transaction IDs and the fallback queue before opening access.
6. Review legal pages with qualified counsel for the jurisdictions served. Default legal text is a draft, not legal advice.
7. The operator confirmed virtual, in-app rentals only. Do not advertise physical property or machine provisioning. New paid rentals require an explicit virtual-only acknowledgement, recorded with the rental. Revisit contracts and integrations before ever offering real-world access.
8. Complete an independent security and financial review before holding customer assets.

## Safety model

- Balances are PostgreSQL `numeric(38,18)` values represented as strings in the API. Updates go through wallet-row locks, ledger entries and transactions.
- Deposit credit keys, billing-period keys and withdrawal settlement keys are unique. UI submissions include request UUIDs for replay protection.
- Withdrawals reserve balances. Rejection unlocks the reserve, while confirmed settlement creates the debit and clears the reserve.
- No funds are transferred without configuration. Automatic service failures enter manual review; ambiguous requests are not automatically resubmitted.
- Uploaded KYC/proofs are private App Storage objects. File bytes are not stored in the database. Access is checked on each read.
- Binance and SMTP secret values are AES-256-GCM encrypted. They are never returned in administrative responses or written to request logs.
- The worker processes billing, expiry, renewal, withdrawal sending/polling, deposit hints, queued mail and daily reconciliation.
- Offline mode is a read-only app shell. Account, financial and private API responses are not cached by the service worker.

## Structure

- `artifacts/mycryptovexa`: React application, brand components, PWA assets and user/admin screens
- `artifacts/api-server/src/routes`: account, workspace, user and admin endpoints
- `artifacts/api-server/src/lib`: transactional ledger, billing, SMTP, Binance and App Storage
- `lib/db/src/schema`: Drizzle source of truth for persistent tables
- `lib/api-spec/openapi.yaml`: generated-client contract

`pnpm --filter @workspace/db run push` is for development. Production schema changes use the platform's normal publish flow, not startup DDL.

## Verification and remaining scope

See `SPECIFICATION_REVIEW.md` for the document-by-document coverage, fixes, verification results and remaining gaps. A working preview is not evidence that live payment providers or every specification feature has been validated.

## Publication gates

- Intended audience: **all countries**, as stated by the operator. This is not blanket legal approval. Obtain country-specific advice on crypto custody, paid virtual goods, referral rewards, consumer protection and restricted jurisdictions; configure legal eligibility and provider restrictions before accepting funds.
- Production bootstrap is implemented using `ADMIN_EMAIL` and secret `ADMIN_PASSWORD` only when no staff account exists. At this review neither production bootstrap variable was configured. Set them securely before publication, or explicitly arrange the initial operator account; there are no default passwords. Never paste passwords into chat or commit them.
- `SESSION_SECRET` exists in shared/production secret configuration. Keep the same value across restarts and replicas: changing it breaks decryption of stored provider credentials and authenticator seeds. Presence is verified; future stability is an operator responsibility.
- No published deployment was present at review. Follow the platform's publication/schema-review flow; never run production startup DDL. Keep the configured API health route `/api/healthz`. The in-process billing/mail workers need an always-running runtime or a separately managed scheduler; do not assume an idle autoscaling instance will tick continuously.
- Configure Binance and SMTP using encrypted **Admin → Settings**. Connection tests and mock mail retries do not establish real delivery or settlement. Validate sender SPF/DKIM and a real inbox, then signup verification, one-use password reset, expiry, and failed-mail retries against the published HTTPS origin.
- Live test authorization must explicitly name **deposit or withdrawal, currency, amount, network, destination and acceptable fee**. Confirm ownership of the receiving address. No external transfer is authorized by a generic request to test; do not submit `withdraw/apply` until the operator has approved that exact transfer.
- Verify the authorized tiny deposit by its blockchain transaction and manual single credit. Verify the authorized withdrawal against Binance history, its lock/debit, TXID and manual fallback. Do not resend an ambiguous withdrawal until history proves it was not submitted.
- Keep registration/funding access restricted until legal, provider, reconciliation, backup/restore and security-review gates are satisfied. Non-English coverage remains partial; the interface now says so. Do not market the platform as complete.

### Safe manual-review UI fixture

For a **development-only** withdrawal/reports walkthrough:

```sh
pnpm --filter @workspace/api-server exec tsx src/tests/manual-withdrawal-fixture.ts seed
# Use the generated temporary fixture privately to sign in normally.
# After the walkthrough, clean up using the exact path returned by seed:
pnpm --filter @workspace/api-server exec tsx src/tests/manual-withdrawal-fixture.ts cleanup /tmp/vexa-manual-withdrawal-<run>.json
```

The fixture has test ledger funding and a reserve, but no real destination. It starts directly in manual review and cannot be approved, retried or marked sent. It never enters the automatic submission queue. The CLI refuses production mode, stores generated credentials temporarily with mode 0600, verifies ownership on cleanup and does not change operator settings. Never use a normal withdrawal submission merely to set up a test.
