-- Which failed checkouts the buyer walked away from, for the abandon limit
ALTER TABLE "Transaction" ADD COLUMN "abandonedByBuyer" BOOLEAN NOT NULL DEFAULT false;
