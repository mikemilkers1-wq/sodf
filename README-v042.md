# RCSO v0.42

## Added
- PDF downloads for Personregister profiles
- PDF downloads for BOLOs, files, arrests and complaints
- formatted official-record PDF layout
- public internal employee directory
- employee profile pages with photo, badge, biography and service details
- administrator editing of employee biography and profile photo

## Header
The Sheriff terminal now uses the compact RinCEN-style account block:
- rank
- employee name
- Log off

The Dark Mode control has been removed.

## Changed files
- lib/setup.js
- app/api/admin/employees/route.js
- components/Portal.js
- app/globals.css

## New files
- app/api/employees/route.js
- public/login/default-profile.png
- README-v042.md

## SQL
No manual SQL is required.
