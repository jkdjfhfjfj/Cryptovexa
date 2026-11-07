# MyCryptoVexa

Crypto-funded property and machine rentals billed per minute, hour or day, with manual deposit approval and a role-based administration console.

## Run & operate

- API workflow: `artifacts/api-server: API Server`
- Web workflow: `artifacts/mycryptovexa: web`
- `pnpm run typecheck` — workspace type checks
- `pnpm --filter @workspace/api-server run test:finance` — rollback-isolated decimal/ledger/rental checks
- `pnpm --filter @workspace/api-spec run codegen` — API hooks and schemas
- `pnpm --filter @workspace/db run push` — development schema only

## Product surfaces

- `/`: user application, wallet, marketplace, rentals, referrals, account security, KYC, help and tickets
- `/admin/login`: separate staff login; first-administrator setup only in development while no staff account exists
- `/admin`: dashboard, reviews, content, settings, staff and operational records
- `/api/v1` and `/api/admin`: shared backend, separate user/admin session scopes

## Architecture and operational decisions

- Balances and rates are decimal strings. Financial arithmetic is PostgreSQL NUMERIC on the server and Decimal.js in previews. Never update balances without the transactional ledger helper.
- Manual withdrawals are enabled by default. No live deposit addresses or service credentials are invented. Empty configuration must fail clearly, never simulate delivery or transfers.
- Password authentication and distinct administrator sessions follow the supplied builder specification. The site name, branding and policies are admin-controlled.
- `SESSION_SECRET` must remain stable: encryption keys are derived using purpose-separated HMAC contexts. Rotating it without migrating encrypted settings makes saved credentials unreadable.
- Private KYC and proofs use App Storage, not database blobs. Public assets must be explicitly referenced by branding settings or asset image lists.
- Rate snapshots protect existing rentals from later price changes. Worker period keys prevent repeated billing.
- Request UUIDs must survive submission retries so transactions can be deduplicated.

## Source of truth

- Uploaded builder specification and logo kit: `attached_assets/`
- Database: `lib/db/src/schema/platform.ts`
- API contracts: `lib/api-spec/openapi.yaml`
- Backend domain modules: `artifacts/api-server/src/lib/`
- User/admin UI: `artifacts/mycryptovexa/src/pages/`
- Brand/loading components: `artifacts/mycryptovexa/src/components/app/brand.tsx`
- Typography/theme: `artifacts/mycryptovexa/src/index.css`
- Operating and launch configuration: `README.md`

## Production readiness

No real Binance transfers or SMTP delivery have been validated. Never treat preview smoke checks or the initial financial unit checks as a complete audit. Configure the operator's deposit addresses, Binance and SMTP, verify small authorized transfers and delivery, review jurisdiction-specific legal text and obtain an independent security/financial review before accepting customer funds.

Production initial admin requires `ADMIN_EMAIL` and secret `ADMIN_PASSWORD`; the public production setup endpoint stays disabled. No startup schema DDL is used.
