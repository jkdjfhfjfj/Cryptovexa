---
name: VPS deployment plan
description: Operator's VPS database and test-before-domain deployment decision.
---

The operator chose a persistent PostgreSQL database and private-disk file storage on the EC2 VPS. The domain is mycryptovexa.com; connect it only after a stable IP is set and the test deployment is verified.

**Why:** the operator asked to install PostgreSQL on the VPS and keep it connected permanently, selected VPS disk storage for private uploads, and named the domain while keeping domain setup as the final step.

**How to apply:** Keep PostgreSQL private to the VPS. Keep private files outside the web root with restrictive permissions and back up the file bytes separately from PostgreSQL. Treat the current instance and database as a test environment until production gates are met; use temporary HTTPS for testing, then connect the domain after a stable IP is assigned.
