-- CreateEnum
CREATE TYPE "DataAlertType" AS ENUM ('STATUS_COLUMN_MISSING', 'REQUIRED_COLUMN_MISSING', 'UNMAPPED_STATUS', 'LEAD_NO_CAMPAIGN', 'WON_NO_VALUE', 'QUOTE_NO_VALUE', 'DQ_NO_REASON', 'LOST_NO_REASON', 'BAD_OPTIN_DATE', 'CAMPAIGN_NAME_UNMATCHED', 'NO_START_DATE', 'NO_INCLUDED_CAMPAIGNS', 'SYNC_FAILED', 'SYNC_STALE', 'SYNC_ABORTED_GUARD', 'GOOGLE_TOKEN_INVALID', 'META_TOKEN_EXPIRED', 'WRITEBACK_FAILED', 'CLIENT_UPDATE_OVERDUE', 'RECONCILE_MISMATCH');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('DANGER', 'WARNING');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "DataAlert" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" "DataAlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "fixHint" TEXT NOT NULL,
    "fixUrl" TEXT,
    "count" INTEGER NOT NULL DEFAULT 0,
    "affectedLeadIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fingerprint" TEXT NOT NULL DEFAULT '',
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "dismissNote" TEXT,
    "clickupTaskId" TEXT,

    CONSTRAINT "DataAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncReconciliation" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sheetCounts" JSONB NOT NULL,
    "hqCounts" JSONB NOT NULL,
    "diffs" JSONB NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataAlert_status_severity_idx" ON "DataAlert"("status", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "DataAlert_clientId_type_fingerprint_key" ON "DataAlert"("clientId", "type", "fingerprint");

-- CreateIndex
CREATE INDEX "SyncReconciliation_clientId_createdAt_idx" ON "SyncReconciliation"("clientId", "createdAt");

-- AddForeignKey
ALTER TABLE "DataAlert" ADD CONSTRAINT "DataAlert_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncReconciliation" ADD CONSTRAINT "SyncReconciliation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

