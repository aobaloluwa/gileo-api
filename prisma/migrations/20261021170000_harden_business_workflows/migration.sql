-- Harden unpaid order reservations, cohort capacity reservations and support conversations.
ALTER TABLE "orders" ADD COLUMN "reservationExpiresAt" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "stockReleasedAt" TIMESTAMP(3);
UPDATE "orders" SET "reservationExpiresAt" = "createdAt" + INTERVAL '30 minutes' WHERE "status" = 'PENDING_PAYMENT';
ALTER TABLE "elevate_cohorts" ADD COLUMN "reservedCount" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "support_messages" (
  "id" UUID NOT NULL,
  "ticketId" UUID NOT NULL,
  "authorId" UUID NOT NULL,
  "message" VARCHAR(4000) NOT NULL,
  "internal" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "support_messages_ticketId_createdAt_idx" ON "support_messages"("ticketId", "createdAt");
CREATE INDEX "support_messages_authorId_idx" ON "support_messages"("authorId");
CREATE INDEX "support_tickets_assignedTo_idx" ON "support_tickets"("assignedTo");
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments" ADD COLUMN "cohortSeatReserved" BOOLEAN NOT NULL DEFAULT false;

-- GILEO uses only CUSTOMER and ADMIN account roles. Community membership and Elevate access
-- are represented by dedicated membership/entitlement records, not account roles. Existing
-- legacy non-admin role assignments become ordinary customer accounts; care assignment remains
-- request-specific through service_requests.assignedProviderId.
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
UPDATE "users" SET "role" = 'CUSTOMER' WHERE "role"::text <> 'ADMIN';
CREATE TYPE "UserRole_new" AS ENUM ('CUSTOMER', 'ADMIN');
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'CUSTOMER'::"UserRole";

-- Role-independent, administrator-managed operational permissions for ordinary user accounts.
CREATE TABLE "user_permissions" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "permission" VARCHAR(60) NOT NULL,
  "grantedBy" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_permissions_userId_permission_key" ON "user_permissions"("userId", "permission");
CREATE INDEX "user_permissions_permission_idx" ON "user_permissions"("permission");
CREATE INDEX "user_permissions_grantedBy_idx" ON "user_permissions"("grantedBy");
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_grantedBy_fkey" FOREIGN KEY ("grantedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
