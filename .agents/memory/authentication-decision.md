---
name: Authentication decision
description: Why this product uses local passwords instead of a managed identity provider.
---
The local password-authentication implementation is intentional; do not silently replace it with Clerk or Replit SSO.

**Why:** The user supplied a complete builder specification explicitly requesting Argon2 passwords, account recovery, TOTP and an independent administrator sign-in realm.

Admin sign-in must obtain browser-reported location before submitting credentials. If location is denied, unavailable, or invalid, do not authenticate. Page access still records IP, browser, time and referring site.

**Why:** The user explicitly required location permission before administrator login and asked to block sign-in when location cannot be obtained.

**How to apply:** Preserve the separate local-password administrator realm and location gate. A switch to a managed identity provider changes the requested product and requires an explicit migration decision.
