-- The row a lead was last read from, so write-back targets that exact row.
-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "sheetRow" INTEGER;
