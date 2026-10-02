-- Additive. Months stored before this read 0 until "Rebuild history".
ALTER TABLE "MonthlyKpi" ADD COLUMN "contacted" INTEGER NOT NULL DEFAULT 0;
