# GILEO backend implementation notes

## Added in this implementation
- Prisma domain schema + SQL migration for services/requests, categories/products/variants, orders/items, Paystack payments, e-books, cohorts, purchases/entitlements, community resources/memberships/announcements, support tickets, nurse assignment, and post-payment care onboarding.
- `CUSTOMER` and `ADMIN` are the only account roles. Community membership and Elevate access are represented separately by membership/entitlement records. The migration converts existing non-admin legacy roles to `CUSTOMER`; assigned providers are ordinary registered users with request-specific access.
- Paystack initialize, server-side verify, HMAC-SHA512 raw-body webhook signature verification, admin refund initiation and a refund reconciliation endpoint for pending refunds.
- Product/variant stock decrement is transactional at order creation. Cancelling an unpaid order restores both variant and non-variant stock exactly once. Paid orders cannot be cancelled directly; they must go through the payment refund workflow. Unpaid reservations expire after 30 minutes and are released by a guarded periodic cleanup.
- Paid e-book/cohort entitlements are granted only after server-side Paystack verification and are specific to the purchased item.
- Service requests remain unconfirmed until staff acceptance; payment initialization requires explicit availability confirmation.
- Care onboarding requires a verified payment and consent. Care details can be read only by the assigned nurse or an admin.
- Admin user directory, dashboard counters, order/payment views, support ticket assignment/status management and ticket conversation messages. All administration endpoints require `ADMIN`.

## Important environment verification still required
The dependency installation in this editing environment timed out, leaving the dependency tree incomplete. After these edits, I could not run a reliable NestJS type-check/build, Prisma schema validation, migration execution, automated tests, or live Paystack test. These checks are required locally before deployment; do not treat this ZIP as build-verified.

Before using the API, run these locally with Node.js 22.22.3+:
1. `npm ci`
2. Copy `.env.example` to `.env` and set `DATABASE_URL`, unique JWT secrets, mail configuration, and Paystack test secret.
3. `npm run db:validate`
4. `npm run db:generate`
5. Back up your development database, then `npm run db:migrate:deploy`
6. `npm run build`
7. `npm test` and `npm run test:e2e`
8. Start with `npm run start:dev`.

If Prisma validation reports a schema issue, do not run migrations against valuable data until it is reconciled. The new migration is additive but must be reviewed against the target database's current migration history.

## Explicitly not complete/needs owner decisions
- Real email/SMS status notifications and live human chat require configured providers/staffing.
- E-book PDFs are stored outside public web roots and delivered through an authenticated endpoint after active entitlement verification. Configure a private persistent `EBOOK_STORAGE_DIR`; production should use private object storage or a persistent encrypted volume and backup policy.
- Refunds accepted by Paystack remain `REFUND_PENDING` unless Paystack reports a processed status. The admin reconciliation endpoint queries Paystack, but it must be validated against the live/test account response format before production. Late charges against expired/cancelled orders require manual payment reconciliation and must not automatically fulfil an order whose stock reservation was released.
- Inventory demo items need approved images, actual stock and prices from the owner.
- Production payment, privacy, retention, medical data, and legal wording require owner review and a real staging integration test.

## New administrative endpoints
- `GET /api/v1/admin/users?search=` — admin-only searchable user directory (up to 100 results).
- `GET /api/v1/admin/users/:id/permissions` and `PUT /api/v1/admin/users/:id/permissions` — admin-only allow-listed operational permission assignment for ordinary user accounts. Supported grants include service catalogue/request operations, provider assignment, inventory, orders, payment read-only, support, learning, community and dashboard access.
- `POST /api/v1/admin/learning/ebooks/:id/file` — admin-only PDF upload (25 MB maximum) into private storage.
- `GET /api/v1/learning/ebooks/:id/content` — authenticated, entitlement-checked PDF download.
- `GET /api/v1/service-requests/assigned` and `PATCH /api/v1/service-requests/:id/provider-status` — normal registered users can view only care requests assigned to them and move them through the limited `ASSIGNED -> IN_PROGRESS -> COMPLETED` path.
- `POST /api/v1/support/tickets/:id/messages` — ticket conversation message, visible only to ticket owner/admin.
- `PATCH /api/v1/admin/support/tickets/:id/assignment` — admin-only ticket assignment. In this role model, assignment is currently limited to administrators.
- `POST /api/v1/admin/payments/:reference/refund/reconcile` — admin-only reconciliation for pending Paystack refunds.
- `POST /api/v1/admin/payments/:reference/reconcile-cancelled` — verifies late charges for expired/cancelled payments without granting fulfilment or learning access; administrators can then decide whether to refund.

## New migration
`20261021170000_harden_business_workflows` adds order reservation fields, cohort `reservedCount`, support message storage, and relevant indexes/foreign keys. Apply only after reviewing the target database migration history and backing up the database.
