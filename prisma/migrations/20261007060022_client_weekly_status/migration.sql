-- AlterTable
ALTER TABLE "User" ADD COLUMN     "weeklyStatusViewedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WeeklyMeeting" ADD COLUMN     "stepsDone" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
