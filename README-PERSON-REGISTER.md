# Sheriff Terminal v0.3.0 — Shared Person Register

This is a complete replacement project based on Sheriff Terminal v0.2.0.

Requirements:
- The Sheriff and RinCEN Vercel projects must point to the same Neon database.
- Add `COUNTY_DEPARTMENT_CODE=RCSO` in the Sheriff Vercel project.
- Run `database/county-person-register.sql` once, or allow `lib/setup.js` to create the tables.

Functions:
- Person search by ID, name, alias, address, postal code, badge or employee number.
- Immutable RCP public ID.
- Core identity, masked identifiers, aliases, address history, photos/mugshots.
- Government and LEO roles, relationships, criminal/custody events and department links.
- BOLO creation can link to an existing person.
- Person profile export through the browser print/PDF dialog.
- Every search, view and change is audited in `county_person_audit`.
