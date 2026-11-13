---
name: VPS deployment setup
description: The operator's self-hosted production VPS and deployment process.
---

The operator chose a persistent PostgreSQL database and private-disk file storage on the EC2 VPS. The stable public IP is 13.62.35.21, and mycryptovexa.com now serves the production site over HTTPS through Nginx and the cryptovexa-api service. GitHub main is the VPS source.

**Why:** the operator asked to install PostgreSQL on the VPS and keep it connected permanently, selected VPS disk storage for private uploads, and later completed DNS and TLS for the production domain.

**How to apply:** Keep PostgreSQL private to the VPS. Deploy by fast-forwarding GitHub main, building the web and API, copying frontend assets to the Nginx web root, restarting cryptovexa-api, testing Nginx configuration, and checking the public API health route and served bundle. Keep private files outside the web root with restrictive permissions and back them up separately from PostgreSQL. Production deployment does not replace the pending real-funds, legal, mail-delivery, and restore-validation gates.
