// Run: npx tsx lib/sales.check.ts — throws on the first failure.
import assert from "node:assert/strict";
import { runningCostPerSale } from "./sales";

// $100/day from 1 Sep. Sale 1 on 2 Sep: $200 / 1. Sale 2 also 2 Sep: $200 / 2.
// Sale 3 on 5 Sep: $500 / 3 (spend after the 5th never counts).
const spend: [string, number][] = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"].map((d) => [d, 100]);
assert.deepEqual(runningCostPerSale(["2026-09-02", "2026-09-02", "2026-09-05"], spend), [200, 100, 500 / 3]);
// No spend → $0; no sales → nothing.
assert.deepEqual(runningCostPerSale(["2026-09-02"], []), [0]);
assert.deepEqual(runningCostPerSale([], spend), []);
console.log("sales: all checks passed");
