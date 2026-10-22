// Run: npx tsx lib/quotes.check.ts — throws on the first failure.
import assert from "node:assert/strict";
import { ageBucket, lostReasonLabel, quoteStatus } from "./quotes";

assert.equal(quoteStatus("WON"), "won");
assert.equal(quoteStatus("LOST"), "lost");
assert.equal(quoteStatus("DISQUALIFIED"), "lost");
assert.equal(quoteStatus("QUOTE_SENT"), "open");
// Sent back to Chase Up after the quote: still outstanding, not lost.
assert.equal(quoteStatus("CHASE_UP"), "open");

assert.equal(lostReasonLabel("LOST", "WENT_ELSEWHERE", null), "Went elsewhere");
assert.equal(lostReasonLabel("LOST", null, null), "Reason missing");
assert.equal(lostReasonLabel("DISQUALIFIED", null, "PRICE_SHOPPER"), "DQ · Price shopper");
assert.equal(lostReasonLabel("QUOTE_SENT", "BUDGET", null), null);

assert.equal(ageBucket(0), "0–7 days");
assert.equal(ageBucket(7), "0–7 days");
assert.equal(ageBucket(8), "8–14 days");
assert.equal(ageBucket(30), "15–30 days");
assert.equal(ageBucket(61), "60+ days");
console.log("quotes: all checks passed");
