---
name: Verification boundaries
description: Why domain money tests do not establish that authenticated workspaces or date serialization work.
---
Exercise authenticated workspace reads and serialized date fields alongside transaction arithmetic.

**Why:** Financial helper tests passed while both signed-in workspaces failed. A schema helper's SQL column name was fixed even when it was assigned to a differently named TypeScript property; static typing did not validate the raw SQL consumers.

**How to apply:** For schema-related changes, verify actual database column names and at least one affected workspace/read/download boundary. Do not infer end-to-end readiness from passing ledger helpers.

## Navigation after authentication

Assert that successful login reveals the signed-in screen **without a manual reload or route change**.

**Why:** Browser checks found valid persisted cookies and audit entries while stale client identity still left the user at the sign-in screen. Manually opening the dashboard would conceal the failed transition.

**How to apply:** Treat automatic navigation and identity-cache refresh as part of the authentication contract, separately from session persistence after reload. Keep customer and administrator cache identities independent.
