-- NeedsActionItem was a recomputed cache (lib/needs-action.ts now computes on read) — no data lost.
-- DropForeignKey
ALTER TABLE "NeedsActionItem" DROP CONSTRAINT "NeedsActionItem_clientId_fkey";

-- DropTable
DROP TABLE "NeedsActionItem";

