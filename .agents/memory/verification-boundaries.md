---
name: Verification boundaries
description: Why domain money tests do not establish that authenticated workspaces or date serialization work.
---
Exercise authenticated workspace reads and serialized date fields alongside transaction arithmetic.

**Why:** Financial helper tests passed while both signed-in workspaces failed. A schema helper's SQL column name was fixed even when it was assigned to a differently named TypeScript property; static typing did not validate the raw SQL consumers.

**How to apply:** For schema-related changes, verify actual database column names and at least one affected workspace/read/download boundary. Do not infer end-to-end readiness from passing ledger helpers.
