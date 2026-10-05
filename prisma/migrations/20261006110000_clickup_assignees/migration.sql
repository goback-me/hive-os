-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "clickupAssigneeIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
