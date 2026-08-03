-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'CLIENT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('DEPOSIT', 'SECOND_PAYMENT', 'FULL_PAYMENT', 'RETAINER');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('ACTIVE', 'EXPIRING', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'DONE');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metaAdAccountId" TEXT,
    "clickupListId" TEXT,
    "swarmProjectId" TEXT,
    "claritySlug" TEXT,
    "stripeCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" "PaymentType" NOT NULL,
    "label" TEXT NOT NULL,
    "amountDue" DECIMAL(10,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paidDate" TIMESTAMP(3),
    "amountPaid" DECIMAL(10,2),
    "stripeInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "monthlyValue" DECIMAL(10,2) NOT NULL,
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactLog" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "contactedAt" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL,
    "notes" TEXT,
    "loggedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdSpendDaily" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "spend" DECIMAL(10,2) NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'meta',

    CONSTRAINT "AdSpendDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueMonthly" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',

    CONSTRAINT "RevenueMonthly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "source" TEXT,
    "campaign" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "value" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referrerName" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "notes" TEXT,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "payoutAmount" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedReport" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "rangeLabel" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'csv',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NeedsActionItem" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(10,2),
    "daysDelta" INTEGER,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NeedsActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Client_slug_key" ON "Client"("slug");

-- CreateIndex
CREATE INDEX "Payment_status_dueDate_idx" ON "Payment"("status", "dueDate");

-- CreateIndex
CREATE INDEX "Contract_status_endDate_idx" ON "Contract"("status", "endDate");

-- CreateIndex
CREATE INDEX "ContactLog_clientId_contactedAt_idx" ON "ContactLog"("clientId", "contactedAt");

-- CreateIndex
CREATE INDEX "AdSpendDaily_clientId_date_idx" ON "AdSpendDaily"("clientId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AdSpendDaily_clientId_date_source_key" ON "AdSpendDaily"("clientId", "date", "source");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueMonthly_clientId_month_key" ON "RevenueMonthly"("clientId", "month");

-- CreateIndex
CREATE INDEX "Lead_clientId_createdAt_idx" ON "Lead"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "Task_clientId_status_idx" ON "Task"("clientId", "status");

-- CreateIndex
CREATE INDEX "Referral_status_createdAt_idx" ON "Referral"("status", "createdAt");

-- CreateIndex
CREATE INDEX "GeneratedReport_createdAt_idx" ON "GeneratedReport"("createdAt");

-- CreateIndex
CREATE INDEX "NeedsActionItem_computedAt_idx" ON "NeedsActionItem"("computedAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactLog" ADD CONSTRAINT "ContactLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdSpendDaily" ADD CONSTRAINT "AdSpendDaily_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueMonthly" ADD CONSTRAINT "RevenueMonthly_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedReport" ADD CONSTRAINT "GeneratedReport_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NeedsActionItem" ADD CONSTRAINT "NeedsActionItem_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
