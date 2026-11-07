---
name: Authentication decision
description: Why this product uses local passwords instead of a managed identity provider.
---
The local password-authentication implementation is intentional; do not silently replace it with Clerk or Replit SSO.

**Why:** The user supplied a complete builder specification explicitly requesting Argon2 passwords, account recovery, TOTP and an independent administrator sign-in realm.

**How to apply:** Preserve those product requirements in authentication changes. A switch to a managed identity provider changes the requested product and requires an explicit migration decision.
