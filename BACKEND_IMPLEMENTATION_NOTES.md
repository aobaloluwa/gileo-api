# GILEO backend implementation notes

## Added in this implementation
- Prisma domain schema + SQL migration for services/requests, categories/products/variants, orders/items, Paystack payments, e-books, cohorts, purchases/entitlements, community resources/memberships/announcements, support tickets, nurse assignment, and post-payment care onboarding.
- `CUSTOMER` default role plus `COMMUNITY_MEMBER`, `NURSE`, `ELEVATE_PARTICIPANT`, `SUPPORT`, `ADMIN`.
- Role checks are performed server-side. New public registrations are never promoted to staff.
- Paystack initialize, server-side verify, HMAC-SHA512 raw-body webhook signature verification, and admin refund initiation.
- Product/variant stock decrement is transactional at order creation. Cancelling an order restores the reserved stock.
- Paid e-book/cohort entitlements are granted only after server-side Paystack verification and are specific to the purchased item.
- Service requests remain unconfirmed until staff acceptance; payment initialization requires explicit availability confirmation.
- Care onboarding requires a verified payment and consent. Care details can be read only by the assigned nurse or an admin.
- Admin dashboard counters and staff support/order/payment views.

## Important environment verification still required
The dependency installation in the isolated editing environment could not complete because the npm cache lacks a locked package and registry access timed out. I therefore ran a TypeScript transpilation/syntax check on all 29 source files (zero syntax diagnostics), but could not honestly claim a full NestJS type-check/build, Prisma schema validation, database migration, or live Paystack test.

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
- Digital file delivery needs private object storage and signed/authorised download URLs; `fileKey` is a storage reference, not a public file-serving implementation.
- Refunds accepted by Paystack remain `REFUND_PENDING` unless Paystack returns a processed status. Confirm the account's refund webhook events and complete final refund reconciliation before production.
- Inventory demo items need approved images, actual stock and prices from the owner.
- Production payment, privacy, retention, medical data, and legal wording require owner review and a real staging integration test.
