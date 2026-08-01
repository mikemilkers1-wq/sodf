# Riverside County Sheriff's Office Terminal v0.1.0

Separate Sheriff terminal for GitHub + Vercel.

## Included modules

- Homepage
- Mitarbeiterliste
- BOLOs
- Akten
- Festnahmen
- Strafanzeigen
- Admin-Menü
- Shared Neon state for all Sheriff users
- Server-side login with signed cookies
- Employee creation
- Audit logging
- Version-conflict protection
- Automatic refresh every 8 seconds
- Global terminal search

## Neon is required

Without Neon, each browser would only have its own local data. This project is already prepared for Neon.

You may use:

1. A new separate Neon project, recommended for now; or
2. The same Neon project as RCDF, using these separate `rcso_*` tables.

It is not yet connected to RCDF or any shared county tables.

## Vercel environment variables

Add:

```text
DATABASE_URL=<your Neon pooled connection string>
RCSO_SESSION_SECRET=<long random secret, at least 24 characters>
RCSO_INITIAL_ADMIN_CODE=<temporary first admin validation code>
```

`RCSO_INITIAL_ADMIN_CODE` is used only when the employee table is empty.

Initial employee key:

```text
Sheriff 1001
```

After first login, create a proper administrator account in the Admin-Menü and remove or deactivate the bootstrap account later.

## Deployment

1. Create a new private GitHub repository.
2. Upload the complete folder contents.
3. Import the repository into Vercel as a new project.
4. Add the three environment variables.
5. Deploy.
6. Open the production URL.

The database tables are created automatically on first request.

## Security note

Do not use `CHANGE-ME-1234` as a real code. Set `RCSO_INITIAL_ADMIN_CODE` in Vercel before the first deployment.
