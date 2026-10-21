# GILEO Medicals API

NestJS + PostgreSQL + Prisma API for the GILEO Medicals mobile platform. The existing authentication foundation is retained and extended with healthcare service requests, medical marketplace, Paystack payments, community content, Gileo Elevate cohorts, e-books, entitlements, support tickets, and staff operations.


## Requirements

- Node.js 22.22.3+ (or Node.js 24.15.0+) as required by the locked NestJS 12 toolchain
- PostgreSQL 15+
- npm
- Paystack test secret key for payment testing

## Local setup

1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL`, strong unique JWT secrets, and mail configuration. Set `PAYSTACK_SECRET_KEY` to a **test** secret key from your Paystack dashboard.
3. Install dependencies: `npm install`.
4. Generate Prisma Client: `npm run db:generate`.
5. Apply migrations to your development database: `npm run db:migrate:deploy`.
6. Start the API: `npm run start:dev`.
7. Open Swagger at `http://localhost:3000/api/docs` in development.
8. Optional for a demo database only: apply `prisma/demo-seed.sql` manually after reviewing the sample estimates. These are illustrative listings, not approved prices or verified inventory.

Do not use `prisma migrate reset` against a database with data you need. Review migrations before applying them to shared/production databases. Make a backup first.

## Paystack setup

`PAYSTACK_SECRET_KEY` is server-only. Never place it in the Expo app. Use a Paystack **test** secret key locally and configure a webhook URL in the Paystack dashboard pointing to:

`https://YOUR_PUBLIC_API_HOST/api/v1/payments/paystack/webhook`

The webhook verifies `x-paystack-signature` using the raw request body. The API also verifies transactions directly with Paystack before granting entitlements or marking an order/service request paid. Configure `PAYSTACK_CALLBACK_URL` to a callback URL supported by your mobile/deep-link flow. Payment initialization returns the Paystack authorization URL and reference.

Amounts are stored as integer kobo; for NGN, ₦1,000 is `100000` kobo. Product/service prices should be entered in kobo. Paystack transactions are verified against reference, status, amount, and currency. A client callback alone never proves payment.

## Security notes

- JWT-protected endpoints require `Authorization: Bearer <accessToken>`.
- Account roles are `CUSTOMER` and `ADMIN` only. Community membership and purchased e-book/cohort access are represented by membership and entitlement records, not account roles. Ordinary registered users may be assigned as care providers for a specific request and can receive allow-listed operational permissions separately. Permission grants cannot give a user the ability to manage users/roles or issue refunds.
- Operational permissions are managed through `GET/PUT /admin/users/:id/permissions` and can be assigned only by an administrator. The permission list is allow-listed in `src/business.dto.ts`; do not add user-management, role-management, or refund privileges to that list.
- Promote the initial administrator only after verifying the account identity, for example through a controlled database operation:
  `UPDATE users SET role = 'ADMIN' WHERE email = 'your-verified-admin-email@example.com';`
  Run that statement manually using a trusted database session; do not expose it as a public endpoint.
- All administrative management endpoints require the server-side `ADMIN` role. Assigned care providers can see only requests assigned to their own account and can update only the limited provider workflow statuses. Guest users can browse published services, products, e-books, cohorts, and public community resources; submitting requests, purchasing, viewing private library items, and managing a profile require authentication.
- Sensitive care details should be collected only at the appropriate stage. This API deliberately keeps the initial service request fields limited.
- This is a starting production architecture, not a claim that a deployment is production-certified. Add operational monitoring, backups, retention policies, privacy/legal review, and security testing before launch.

## API overview

All routes use `/api/v1`.

### Authentication (existing)
- `POST /auth/register`, `/auth/verify-email`, `/auth/login`
- `POST /auth/forgot-password`, `/auth/reset-password`, `/auth/resend-verification`
- `POST /auth/google`, `/auth/refresh`, `/auth/logout`
- `GET /auth/me`

### Healthcare
- `GET /services`
- `POST /service-requests` (authenticated)
- `POST /service-requests/onboarding` (authenticated; only after verified payment)
- `GET /service-requests/:id/onboarding` (assigned provider or admin only)
- `POST /service-requests/:id/assign-provider` (admin; provider must be a registered non-admin user)
- `GET /service-requests/mine` and `GET /service-requests/assigned` (authenticated; assigned list is record-scoped)
- `PATCH /service-requests/:id/provider-status` (assigned provider; limited transitions only)
- `GET /service-requests` and `PATCH /service-requests/:id/status` (admin only)

A request is not a confirmed booking. An administrator must review it and explicitly accept/confirm availability before the API permits payment initialization.

### Marketplace
- `GET /shop/categories`, `GET /shop/products`
- `POST /shop/orders`, `GET /shop/orders/mine` (authenticated)
- Admin operations: create categories/products/variants, edit product details, update product/variant stock, list orders, and update fulfilment status.

Products marked `isDemo: true` and draft listings should not be presented as verified inventory. Variant and non-variant stock is reserved during order creation and returned exactly once if an unpaid order is cancelled or its 30-minute reservation expires. Paid orders cannot be cancelled directly; refunds must use the payment workflow.

### Learning and community
- `GET /learning/ebooks`, `GET /learning/cohorts`, `GET /community/resources`
- `GET /learning/library`, `POST /community/join` (authenticated)
- Admins can create/edit e-books, create cohorts, community resources, and announcements.
- Entitlements are granted only after verified payment and are scoped to the specific e-book or cohort purchased.

### Paystack
- `POST /payments/initialize` (authenticated): `{ "purchaseType": "SHOP_ORDER|SERVICE_REQUEST|EBOOK|ELEVATE_COHORT", "targetId": "..." }`
- `POST /payments/verify/:reference` (authenticated)
- `POST /payments/paystack/webhook` (Paystack webhook; signature verified)
- `GET /admin/payments` (staff/admin)
- `POST /admin/payments/:reference/refund` (admin)

### Support and administration
- User access model: guests browse public content; registered users use a single customer account for profile, service requests, orders, and purchases; community membership and paid cohort/e-book access are separate entitlements. Staff roles are server-enforced.
- `POST /support/tickets`, `GET /support/tickets/mine` (authenticated)
- Staff can list/update support tickets.
- `GET /admin/dashboard` and `PATCH /admin/users/:id/role` (admin)

## Payment lifecycle

`INITIALIZED → PENDING → VERIFIED` (or `FAILED`). Refunds move to `REFUND_PENDING` until Paystack reports a processed refund; the final webhook/settlement lifecycle should be verified against the Paystack account and enabled event configuration. Never manually set an order or learning entitlement to paid based only on a user claim or uploaded receipt.

## Testing

Run:
- `npm run build`
- `npm test`
- `npm run test:e2e`
- `npm run db:validate`

The uploaded starter project did not include a live database or Paystack credentials, so these environment-dependent checks must be run locally before calling the implementation verified.

### Administration, private learning content and support
- `GET /admin/users?search=` (admin-only user directory)
- `POST /admin/learning/ebooks/:id/file` (admin-only valid PDF upload, max 25 MB; private storage)
- `GET /learning/ebooks/:id/content` (authenticated; requires an active e-book entitlement)
- `POST /support/tickets/:id/messages` (ticket owner or admin)
- `PATCH /admin/support/tickets/:id/assignment` (admin-only; currently assignable to an admin account)
- `POST /admin/payments/:reference/refund` and `/refund/reconcile` (admin-only)
- `POST /admin/payments/:reference/reconcile-cancelled` verifies late charges without granting fulfilment; the admin must decide whether to refund.

Migration `20261021170000_harden_business_workflows` simplifies the account role enum to `CUSTOMER` and `ADMIN`, adds operational permission grants, and converts existing non-admin role values to `CUSTOMER`; provider assignments remain attached to individual service requests. Back up the database and review the migration before applying it.
