-- Client-page tabs hidden from the client's own login.
ALTER TABLE "Client" ADD COLUMN "hiddenTabs" TEXT[] DEFAULT ARRAY[]::TEXT[];
