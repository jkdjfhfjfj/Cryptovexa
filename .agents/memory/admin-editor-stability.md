---
name: Admin editor stability
description: Project-specific behavior for automatic refresh and unsaved admin edits.
---

Do not automatically refresh admin workspace data while staff are editing. Use explicit refresh and action-scoped revalidation, preserve dirty local editor state when server data changes, and warn before a browser reload with unsaved changes.

**Why:** The user repeatedly reported that automatic refresh interrupts admin editing and prevents changes from being completed.

**How to apply:** Keep admin queries free of polling and automatic mount/focus/reconnect refetches. When adding admin editors, ensure incoming workspace responses cannot replace dirty drafts; refresh only after relevant actions or explicit user request.
