---
name: VPS deployment plan
description: Operator's VPS database and test-before-domain deployment decision.
---

The operator chose a persistent PostgreSQL database on the EC2 VPS. The initial VPS deployment is for testing; connect the owned domain only after testing.

**Why:** the operator asked to install PostgreSQL on the VPS and keep it connected permanently, with domain setup as the final step.

**How to apply:** Keep PostgreSQL private to the VPS. Treat the current instance and database as a fresh test environment until the operator confirms production use. Use a temporary HTTPS hostname for testing, then connect the real domain after approval.
