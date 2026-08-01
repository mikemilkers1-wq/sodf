# Sheriff Terminal v0.3.1

Fixes:
- Person profiles can now be edited by authorized Sheriff users.
- Add addresses, government/LEO roles, relationships, aliases, events and photos.
- Record creation and edits synchronize their person link.
- Deleting a BOLO, arrest, complaint or file removes its county_person_links row.
- Reassigning a record to another person removes the old link and creates the new link.
- No new SQL migration is required.
