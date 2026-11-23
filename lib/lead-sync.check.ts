// Run: npx tsx lib/lead-sync.check.ts — throws on the first failure.
import assert from "node:assert/strict";
import { leadMatcher } from "./lead-sync";
import { normalizeEmail, normalizeName, normalizePhone } from "./sheet-parse";

const P = normalizePhone("0411330629");

const lead = (id: string, phone: string | null, email: string | null = null, deleted = false) => ({ id, name: "Michelle Tucker", phone, email, deletedAt: deleted ? new Date() : null });

// Two rows sharing a phone (no email) each keep their own lead, the same
// ones every sync — whatever order the database returns them in.
for (const leads of [
  [lead("b", "0411330629"), lead("a", "0411330629"), lead("old", "0411330629", null, true)],
  [lead("old", "0411330629", null, true), lead("a", "0411330629"), lead("b", "0411330629")],
]) {
  const match = leadMatcher(leads);
  const claimed = new Map<string, number>();
  const rowLeads = [0, 1].map((row) => {
    const l = match("", P, normalizeName("Michelle Tucker"), row, claimed);
    if (l) claimed.set(l.id, row);
    return l?.id;
  });
  assert.deepEqual(rowLeads, ["a", "b"]);
}

// A third duplicate row only then reaches the soft-deleted lead (restored,
// not a new one); a fourth has none left → a new lead.
{
  const match = leadMatcher([lead("a", "0411330629"), lead("b", "0411330629"), lead("old", "0411330629", null, true)]);
  const claimed = new Map([["a", 0], ["b", 1]]);
  assert.equal(match("", P, "", 2, claimed)?.id, "old");
  claimed.set("old", 2);
  assert.equal(match("", P, "", 3, claimed), undefined);
}

// Same email → same lead, even when already claimed (duplicate rows merge).
{
  const match = leadMatcher([lead("a", null, "m@x.com")]);
  assert.equal(match(normalizeEmail("m@x.com"), "", "", 5, new Map([["a", 0]]))?.id, "a");
}

console.log("lead-sync: all checks passed");
