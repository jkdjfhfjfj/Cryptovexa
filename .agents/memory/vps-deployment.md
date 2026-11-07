---
name: VPS deployment plan
description: Operator's VPS database and test-before-domain deployment decision.
---

The operator chose a persistent PostgreSQL database and private-disk file storage on the EC2 VPS. The associated Elastic IP and outbound IP are 13.62.35.21. Temporary HTTPS testing is at https://13.62.35.21.sslip.io. mycryptovexa.com currently has no A record and www is unresolved.

**Why:** the operator asked to install PostgreSQL on the VPS and keep it connected permanently, selected VPS disk storage for private uploads, and named the domain while keeping domain setup as the final step. A stable IP is now verified, but DNS still blocks the final domain certificate.

**How to apply:** Keep PostgreSQL private to the VPS. Keep private files outside the web root with restrictive permissions and back up the file bytes separately from PostgreSQL. Have the operator set apex A to 13.62.35.21 and www CNAME to mycryptovexa.com, then issue TLS for both hosts and update SMTP public URL/logo. Treat the current instance and database as a test environment until production gates are met.
