-- Drive modifiedTime at the last sync: the minute sync skips unchanged sheets.
-- AlterTable
ALTER TABLE "ClientSheet" ADD COLUMN "sheetModifiedAt" TIMESTAMP(3);
