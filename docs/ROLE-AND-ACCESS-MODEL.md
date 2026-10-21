# GILEO account and access model

## Product-facing access levels

1. **Guest** — no account. Read-only access to published healthcare services, product catalogue, public community information/resources, published e-books and Elevate cohort descriptions. No private data, service request submission, checkout, account profile, or purchased content.
2. **Registered user (`CUSTOMER`)** — one account for profile, healthcare requests and status, orders, purchases, support tickets, and the personal library. Community membership is represented by `CommunityMembership`; purchased books and paid cohorts are represented by distinct `Entitlement` records.
3. **Administrator** — the only role with administrative management access. Ordinary registered users remain ordinary user accounts; nurses and operational helpers do not receive a special privileged role. An administrator may assign a registered non-admin user as a care provider for a specific request. That assignment grants access only to that request’s care information and a limited endpoint to move the assigned request through its permitted work statuses. Never grant administrator access from public registration. The migration converts legacy non-admin role values to `CUSTOMER`. Administrators can grant a small allow-listed set of operational permissions to ordinary users; permissions are stored separately from account roles, and there is no permission for users to manage other users, change roles, or issue refunds.

## Important permission boundaries

- `GET /services`, `GET /shop/categories`, `GET /shop/products`, `GET /learning/ebooks`, `GET /learning/cohorts`, and `GET /community/resources` are public browse endpoints.
- Requests, checkout/orders, library access, profile, and support tickets require authentication.
- Care onboarding requires consent and verified payment. Care information is restricted to the assigned provider and authorized administrators.
- An uploaded receipt or client assertion does not verify payment. Paystack verification/webhook remains server-side.
- E-book entitlement does not grant cohort access; cohort entitlement does not grant unrelated e-books.
- User/role/permission administration and refunds require `ADMIN`. Other operational tools require explicit administrator-granted permissions such as `ORDERS_MANAGE`, `INVENTORY_MANAGE`, `SUPPORT_MANAGE`, or `SERVICE_REQUESTS_MANAGE`. Assigned care-provider access is record-specific. Permissions cannot grant user-management or refund powers.
- Order stock reservations expire after 30 minutes and are released by a guarded background cleanup; a late Paystack charge on a cancelled reservation must be reconciled by an administrator before fulfilment.
- E-book PDFs are uploaded to private server storage and streamed only to users with an active entitlement. Set `EBOOK_STORAGE_DIR` to a private persistent volume in production.
- Support tickets have threaded messages and administrator assignment/status management.

## Migration note

Migration `20261021170000_harden_business_workflows` adds order reservation expiry/release fields, cohort checkout reservations and support conversation messages. Apply migrations using the normal reviewed migration workflow; back up shared databases first. The older role migration remains in history for existing databases; legacy role values are not granted administrative access.
