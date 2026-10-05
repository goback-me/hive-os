// Fallback classifier for note entries the regex rules in lib/notes-parser.ts
// couldn't place. One batched call per sync (chunked), JSON-schema-constrained
// to the same event enum. No ANTHROPIC_API_KEY → returns null and the caller
// keeps those entries as NOTE.

import Anthropic from "@anthropic-ai/sdk";
import { type NoteEventValue } from "./notes-parser";
import { DQ_REASONS, type DqReasonValue } from "./lead-status";

const MODEL = "claude-sonnet-4-6";
const BATCH = 100;
// The events this pass may answer with — the call-attempt kinds and
// AM_SCENARIO come from the rules (lib/notes-parser.ts), never from here.
const AI_EVENTS: NoteEventValue[] = ["CALL_ATTEMPT", "DQ_SPAM", "HANDOVER_LIVE", "HANDOVER_TEXT", "CONSULT_BOOKED", "CONSULT_ATTENDED", "QUOTE_SENT", "NOTE"];

const SYSTEM = `You classify short call-centre notes about sales leads for an Australian home-services agency.
Each note is one touch logged by the team. Pick exactly one event per note:
- CALL_ATTEMPT: tried to reach the lead and didn't get through (no answer, voicemail, text sent, busy, call back later)
- DQ_SPAM: bad or fake lead (wrong/disconnected number, invalid details, test lead)
- HANDOVER_LIVE: lead was transferred live on the phone to the client
- HANDOVER_TEXT: lead was handed to the client by text/email, or a live transfer was attempted
- CONSULT_BOOKED: a consult, site visit or inspection was booked
- CONSULT_ATTENDED: the consult, site visit or inspection happened
- QUOTE_SENT: a quote was provided
- NOTE: anything else (general comments, qualification details, follow-ups that aren't the above)
Notes are terse and use shorthand. When unsure, answer NOTE.`;

const SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "integer" }, event: { type: "string", enum: AI_EVENTS } },
        required: ["id", "event"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

// texts[i] → event. Returns null when there's no API key; throws on API
// errors so the sync can retry those notes next time.
export async function classifyNotesWithAI(texts: string[]): Promise<NoteEventValue[] | null> {
  if (!process.env.ANTHROPIC_API_KEY || !texts.length) return null;
  const client = new Anthropic();
  const out: NoteEventValue[] = texts.map(() => "NOTE");

  for (let start = 0; start < texts.length; start += BATCH) {
    const batch = texts.slice(start, start + BATCH);
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Classify each note. Return one result per id.\n\n${batch.map((t, i) => `${i}: ${t}`).join("\n")}`,
        },
      ],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    });
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
      throw new Error(`Note classification stopped early (${response.stop_reason})`);
    }
    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
    const parsed = JSON.parse(text) as { results: { id: number; event: NoteEventValue }[] };
    for (const r of parsed.results) {
      if (Number.isInteger(r.id) && r.id >= 0 && r.id < batch.length && AI_EVENTS.includes(r.event)) out[start + r.id] = r.event;
    }
  }
  return out;
}

// ── Why a lead was disqualified ──────────────────────────────────────────
// For DQ'd leads whose feedback the rules (dqFromNotes) couldn't read — an
// account manager's write-up, say. Haiku, strict reason enum + a short
// evidence line. Same contract as above: null without a key, throws on API
// errors.
const DQ_MODEL = "claude-haiku-4-5";
const DQ_BATCH = 50;

const DQ_SYSTEM = `You read the call notes for sales leads an Australian home-services agency disqualified, and say why each was disqualified.
Pick exactly one reason per lead:
- SPAM: fake or unreachable details (wrong/disconnected number, test lead)
- LOCATION: outside the area the business services
- BUDGET: couldn't afford it / too expensive
- PRICE_SHOPPER: only collecting quotes or looking around on price
- NOT_INTERESTED: didn't want it, didn't enquire, already has someone
- GHOSTED: stopped responding
- NOT_SUITABLE: the job or the person isn't a fit for the service
- UNKNOWN: the notes don't say
Evidence: at most 20 words, quoting or paraphrasing the notes that show the reason. When unsure, answer UNKNOWN.`;

const DQ_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "integer" }, reason: { type: "string", enum: [...DQ_REASONS] }, evidence: { type: "string" } },
        required: ["id", "reason", "evidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

const words20 = (s: string) => s.trim().split(/\s+/).slice(0, 20).join(" ");

// leads[i] = that lead's note entries, oldest first → its reason.
export async function classifyDqWithAI(leads: string[][]): Promise<{ reason: DqReasonValue; evidence: string }[] | null> {
  if (!process.env.ANTHROPIC_API_KEY || !leads.length) return null;
  const client = new Anthropic();
  const out = leads.map(() => ({ reason: "UNKNOWN" as DqReasonValue, evidence: "" }));

  for (let start = 0; start < leads.length; start += DQ_BATCH) {
    const batch = leads.slice(start, start + DQ_BATCH);
    const response = await client.messages.create({
      model: DQ_MODEL,
      max_tokens: 8000,
      system: DQ_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Give each lead's DQ reason. Return one result per id.\n\n${batch.map((notes, i) => `Lead ${i}:\n${notes.map((n) => `- ${n}`).join("\n")}`).join("\n\n")}`,
        },
      ],
      output_config: { format: { type: "json_schema", schema: DQ_SCHEMA } },
    });
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
      throw new Error(`DQ classification stopped early (${response.stop_reason})`);
    }
    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
    const parsed = JSON.parse(text) as { results: { id: number; reason: DqReasonValue; evidence: string }[] };
    for (const r of parsed.results) {
      if (Number.isInteger(r.id) && r.id >= 0 && r.id < batch.length && DQ_REASONS.includes(r.reason)) out[start + r.id] = { reason: r.reason, evidence: words20(r.evidence ?? "") };
    }
  }
  return out;
}
