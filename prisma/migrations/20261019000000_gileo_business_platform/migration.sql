CREATE TYPE "UserRole" AS ENUM ('CUSTOMER','COMMUNITY_MEMBER','NURSE','ELEVATE_PARTICIPANT','SUPPORT','ADMIN');
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT','PUBLISHED','ARCHIVED');
CREATE TYPE "ServiceRequestStatus" AS ENUM ('SUBMITTED','UNDER_REVIEW','ACCEPTED','DECLINED','AWAITING_PAYMENT','PAID','ONBOARDING_REQUIRED','ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED');
CREATE TYPE "PaymentStatus" AS ENUM ('INITIALIZED','PENDING','AWAITING_VERIFICATION','VERIFIED','REFUND_PENDING','FAILED','CANCELLED','REFUNDED');
CREATE TYPE "PurchaseType" AS ENUM ('SHOP_ORDER','SERVICE_REQUEST','EBOOK','ELEVATE_COHORT');
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT','PAID','PROCESSING','FULFILMENT','SHIPPED','DELIVERED','CANCELLED','REFUNDED');
CREATE TYPE "EntitlementType" AS ENUM ('EBOOK','ELEVATE_COHORT');
CREATE TYPE "SupportStatus" AS ENUM ('OPEN','IN_PROGRESS','RESOLVED','CLOSED');

ALTER TABLE "users" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER';

CREATE TABLE "services" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "slug" VARCHAR(120) NOT NULL, "title" VARCHAR(160) NOT NULL,
 "description" TEXT NOT NULL, "audience" TEXT, "whatIsIncluded" TEXT, "priceKobo" INTEGER, "priceLabel" VARCHAR(120),
 "isIndicative" BOOLEAN NOT NULL DEFAULT true, "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "services_slug_key" ON "services"("slug");
CREATE INDEX "services_status_idx" ON "services"("status");

CREATE TABLE "service_requests" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "reference" VARCHAR(32) NOT NULL, "userId" UUID NOT NULL,
 "serviceId" UUID NOT NULL, "assignedProviderId" UUID, "status" "ServiceRequestStatus" NOT NULL DEFAULT 'SUBMITTED', "preferredDate" TIMESTAMP(3),
 "location" VARCHAR(255), "customerNote" VARCHAR(2000), "adminNote" VARCHAR(2000), "amountKobo" INTEGER,
 "currency" VARCHAR(3) NOT NULL DEFAULT 'NGN', "availabilityConfirmed" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "service_requests_reference_key" ON "service_requests"("reference");
CREATE INDEX "service_requests_userId_createdAt_idx" ON "service_requests"("userId","createdAt");
CREATE INDEX "service_requests_status_idx" ON "service_requests"("status");
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_assignedProviderId_fkey" FOREIGN KEY ("assignedProviderId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "product_categories" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "name" VARCHAR(100) NOT NULL, "slug" VARCHAR(120) NOT NULL,
 "description" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "product_categories_name_key" ON "product_categories"("name");
CREATE UNIQUE INDEX "product_categories_slug_key" ON "product_categories"("slug");

CREATE TABLE "products" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "categoryId" UUID NOT NULL, "slug" VARCHAR(160) NOT NULL,
 "title" VARCHAR(180) NOT NULL, "description" TEXT NOT NULL, "priceKobo" INTEGER NOT NULL, "stock" INTEGER NOT NULL DEFAULT 0,
 "currency" VARCHAR(3) NOT NULL DEFAULT 'NGN', "images" JSONB NOT NULL, "isDemo" BOOLEAN NOT NULL DEFAULT true,
 "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");
CREATE INDEX "products_categoryId_status_idx" ON "products"("categoryId","status");
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "product_variants" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "productId" UUID NOT NULL, "sku" VARCHAR(100) NOT NULL,
 "name" VARCHAR(120) NOT NULL, "size" VARCHAR(40), "colour" VARCHAR(60), "stock" INTEGER NOT NULL DEFAULT 0,
 "isAvailable" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");
CREATE INDEX "product_variants_productId_idx" ON "product_variants"("productId");
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "orders" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "reference" VARCHAR(32) NOT NULL, "userId" UUID NOT NULL,
 "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT', "subtotalKobo" INTEGER NOT NULL, "deliveryKobo" INTEGER NOT NULL DEFAULT 0,
 "totalKobo" INTEGER NOT NULL, "currency" VARCHAR(3) NOT NULL DEFAULT 'NGN', "shippingAddress" JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "orders_reference_key" ON "orders"("reference");
CREATE INDEX "orders_userId_createdAt_idx" ON "orders"("userId","createdAt");
CREATE INDEX "orders_status_idx" ON "orders"("status");
ALTER TABLE "orders" ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "order_items" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "orderId" UUID NOT NULL, "productId" UUID NOT NULL, "variantId" UUID,
 "titleSnapshot" VARCHAR(180) NOT NULL, "skuSnapshot" VARCHAR(100), "unitPriceKobo" INTEGER NOT NULL,
 "quantity" INTEGER NOT NULL, "lineTotalKobo" INTEGER NOT NULL, CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payments" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "reference" VARCHAR(100) NOT NULL, "activeKey" VARCHAR(220), "userId" UUID NOT NULL,
 "purchaseType" "PurchaseType" NOT NULL, "orderId" UUID, "serviceRequestId" UUID, "ebookId" UUID, "cohortId" UUID,
 "amountKobo" INTEGER NOT NULL, "currency" VARCHAR(3) NOT NULL DEFAULT 'NGN', "status" "PaymentStatus" NOT NULL DEFAULT 'INITIALIZED',
 "paystackAccessCode" VARCHAR(255), "paystackTransactionId" VARCHAR(100), "authorizationUrl" TEXT, "paidAt" TIMESTAMP(3),
 "verifiedAt" TIMESTAMP(3), "gatewayResponse" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payments_reference_key" ON "payments"("reference");
CREATE UNIQUE INDEX "payments_activeKey_key" ON "payments"("activeKey");
CREATE INDEX "payments_userId_createdAt_idx" ON "payments"("userId","createdAt");
CREATE INDEX "payments_status_idx" ON "payments"("status");
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ebooks" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "slug" VARCHAR(160) NOT NULL, "title" VARCHAR(200) NOT NULL,
 "description" TEXT NOT NULL, "author" VARCHAR(120) NOT NULL DEFAULT 'Gileo Medicals', "priceKobo" INTEGER NOT NULL,
 "priceLabel" VARCHAR(120), "isIndicative" BOOLEAN NOT NULL DEFAULT true, "currency" VARCHAR(3) NOT NULL DEFAULT 'NGN', "coverImage" TEXT, "fileKey" TEXT, "isDemo" BOOLEAN NOT NULL DEFAULT true,
 "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ebooks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ebooks_slug_key" ON "ebooks"("slug");
CREATE INDEX "ebooks_status_idx" ON "ebooks"("status");

CREATE TABLE "elevate_cohorts" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "slug" VARCHAR(160) NOT NULL, "title" VARCHAR(200) NOT NULL,
 "overview" TEXT NOT NULL, "learningOutcomes" JSONB NOT NULL, "eligibility" TEXT, "startsAt" TIMESTAMP(3), "endsAt" TIMESTAMP(3),
 "schedule" TEXT, "priceKobo" INTEGER NOT NULL, "currency" VARCHAR(3) NOT NULL DEFAULT 'NGN', "capacity" INTEGER,
 "enrolledCount" INTEGER NOT NULL DEFAULT 0, "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "elevate_cohorts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "elevate_cohorts_slug_key" ON "elevate_cohorts"("slug");
CREATE INDEX "elevate_cohorts_status_idx" ON "elevate_cohorts"("status");
ALTER TABLE "payments" ADD CONSTRAINT "payments_ebookId_fkey" FOREIGN KEY ("ebookId") REFERENCES "ebooks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "elevate_cohorts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "learning_purchases" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "userId" UUID NOT NULL, "ebookId" UUID NOT NULL, "paymentId" UUID,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "learning_purchases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "learning_purchases_userId_ebookId_key" ON "learning_purchases"("userId","ebookId");
CREATE INDEX "learning_purchases_userId_idx" ON "learning_purchases"("userId");
ALTER TABLE "learning_purchases" ADD CONSTRAINT "learning_purchases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "learning_purchases" ADD CONSTRAINT "learning_purchases_ebookId_fkey" FOREIGN KEY ("ebookId") REFERENCES "ebooks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "cohort_enrollments" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "userId" UUID NOT NULL, "cohortId" UUID NOT NULL, "paymentId" UUID,
 "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "cohort_enrollments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cohort_enrollments_userId_cohortId_key" ON "cohort_enrollments"("userId","cohortId");
CREATE INDEX "cohort_enrollments_userId_idx" ON "cohort_enrollments"("userId");
ALTER TABLE "cohort_enrollments" ADD CONSTRAINT "cohort_enrollments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cohort_enrollments" ADD CONSTRAINT "cohort_enrollments_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "elevate_cohorts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "entitlements" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "userId" UUID NOT NULL, "type" "EntitlementType" NOT NULL,
 "ebookId" UUID, "cohortId" UUID, "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "revokedAt" TIMESTAMP(3),
 CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "entitlements_userId_type_revokedAt_idx" ON "entitlements"("userId","type","revokedAt");
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_ebookId_fkey" FOREIGN KEY ("ebookId") REFERENCES "ebooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "elevate_cohorts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "community_memberships" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "userId" UUID NOT NULL, "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "community_memberships_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "community_memberships_userId_key" ON "community_memberships"("userId");
ALTER TABLE "community_memberships" ADD CONSTRAINT "community_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "community_resources" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "title" VARCHAR(200) NOT NULL, "slug" VARCHAR(160) NOT NULL,
 "description" TEXT NOT NULL, "content" TEXT, "resourceUrl" TEXT, "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "community_resources_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "community_resources_slug_key" ON "community_resources"("slug");
CREATE INDEX "community_resources_status_idx" ON "community_resources"("status");

CREATE TABLE "announcements" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "title" VARCHAR(200) NOT NULL, "slug" VARCHAR(160) NOT NULL,
 "body" TEXT NOT NULL, "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT', "publishedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "announcements_slug_key" ON "announcements"("slug");
CREATE INDEX "announcements_status_publishedAt_idx" ON "announcements"("status","publishedAt");

CREATE TABLE "care_onboarding" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "serviceRequestId" UUID NOT NULL, "userId" UUID NOT NULL,
 "patientName" VARCHAR(160) NOT NULL, "contactPhone" VARCHAR(30) NOT NULL, "emergencyContactName" VARCHAR(160) NOT NULL,
 "emergencyContactPhone" VARCHAR(30) NOT NULL, "careNotes" VARCHAR(3000), "consentToCareData" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "care_onboarding_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "care_onboarding_serviceRequestId_key" ON "care_onboarding"("serviceRequestId");
CREATE INDEX "care_onboarding_userId_idx" ON "care_onboarding"("userId");
ALTER TABLE "care_onboarding" ADD CONSTRAINT "care_onboarding_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "care_onboarding" ADD CONSTRAINT "care_onboarding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "support_tickets" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "reference" VARCHAR(32) NOT NULL, "userId" UUID NOT NULL,
 "category" VARCHAR(60) NOT NULL, "subject" VARCHAR(180) NOT NULL, "message" VARCHAR(4000) NOT NULL,
 "status" "SupportStatus" NOT NULL DEFAULT 'OPEN', "assignedTo" UUID,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "support_tickets_reference_key" ON "support_tickets"("reference");
CREATE INDEX "support_tickets_userId_createdAt_idx" ON "support_tickets"("userId","createdAt");
CREATE INDEX "support_tickets_status_idx" ON "support_tickets"("status");
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
