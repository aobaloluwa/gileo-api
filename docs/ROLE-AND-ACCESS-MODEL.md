# GILEO account and access model

## Product-facing access levels

1. **Guest** — no account. Read-only access to published healthcare services, product catalogue, public community information/resources, published e-books and Elevate cohort descriptions. No private data, service request submission, checkout, account profile, or purchased content.
2. **Registered user (`CUSTOMER`)** — one account for profile, healthcare requests and status, orders, purchases, support tickets, and the personal library. Community membership is represented by `CommunityMembership`; purchased books and paid cohorts are represented by distinct `Entitlement` records.
3. **Administrators and staff** — authenticated, server-authorized access. `ADMIN` controls administration and content/role management. `STAFF` and `SUPPORT` can access staff-scoped operational queues. Specialist `NURSE` remains available for provider assignment and care access rules. Never grant privileged roles from public registration.

## Important permission boundaries

- `GET /services`, `GET /shop/categories`, `GET /shop/products`, `GET /learning/ebooks`, `GET /learning/cohorts`, and `GET /community/resources` are public browse endpoints.
- Requests, checkout/orders, library access, profile, and support tickets require authentication.
- Care onboarding requires consent and verified payment. Care information is restricted to the assigned provider and authorized administrators.
- An uploaded receipt or client assertion does not verify payment. Paystack verification/webhook remains server-side.
- E-book entitlement does not grant cohort access; cohort entitlement does not grant unrelated e-books.
- `STAFF` is an operational staff role, not an administrator role. Role changes are administrator-only.

## Migration note

Migration `20261020150000_add_staff_role` adds the `STAFF` enum value while preserving existing roles and user assignments. Apply migrations using the normal reviewed migration workflow; back up shared databases first.
