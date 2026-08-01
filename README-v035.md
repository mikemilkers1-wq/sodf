# Sheriff Terminal v0.3.5 — Reciprocal Personregister relationships

Replace the included Sheriff files.

Shared Neon requirement:
- The one-time migration `database/relationship-reciprocity-v107.sql` only needs to be run once in the shared database.
- If it was already run for RinCEN v1.0.7, do not run it again.

Behavior:
- Creating a relationship from RCSO creates the reciprocal relationship on the other person profile.
- Parent ↔ Child
- Guardian ↔ Ward
- Employer ↔ Employee
- Supervisor ↔ Subordinate
- Spouse, Sibling, Household Member and Business Associate remain symmetrical.
- Editing updates both sides.
- Removing removes both sides.
- Every change is audited for both people.
- Sheriff Administrator can run the legacy reciprocity repair action.
- Keeps the favicon and app-icon fixes from v0.3.4.
