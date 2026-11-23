-- A person's earlier rows in the sheet, listed on the lead (their latest row).
-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "earlierEnquiries" TEXT[] DEFAULT ARRAY[]::TEXT[];
