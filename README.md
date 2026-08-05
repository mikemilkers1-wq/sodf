# Riverside County Sheriff's Office Terminal v0.2.0

## Included changes

- Official Sheriff badge as login logo, header logo, favicon, shortcut and app icon.
- Brown, bronze, ochre and parchment interface based on the badge wreath.
- Explicit contrast-safe text colors for every light and dark surface.
- BOLO type selection: Individual, Vehicle, Property / Object, Unknown Subject.
- Cleaner homepage with welcome panel, role briefing, recent records and compact counters.
- Separate Admin Menu authorization using `RCSO_INITIAL_ADMIN_CODE`.
- Admin unlock is limited to Sheriff Administrator accounts and lasts 30 minutes.
- Operational role permissions:
  - Sheriff Administrator: full access plus separately unlocked employee administration.
  - Supervisor: create, edit and delete operational records.
  - Deputy: create and edit, but not delete.
  - Dispatcher: create/edit BOLOs; other modules read-only.
  - Read Only: view only.

No SQL migration is required.

Environment variables:
- DATABASE_URL
- RCSO_SESSION_SECRET
- RCSO_INITIAL_ADMIN_CODE

Initial login:
- Employee key: Sheriff 1001
- Validation code: value of RCSO_INITIAL_ADMIN_CODE
