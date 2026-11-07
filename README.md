# MyCryptoVexa

Crypto-funded, time-billed property and machine rentals. Includes a React user application at `/`, an administrative console at `/admin`, and an Express API at `/api`.

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
7. Arrange real-world property access and machine provisioning. The platform reserves rental capacity; it does not itself provision remote GPU infrastructure or grant physical building access.
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
