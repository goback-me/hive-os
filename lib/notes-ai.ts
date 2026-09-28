// Fallback classifier for note entries the regex rules in lib/notes-parser.ts
// couldn't place. One batched call per sync (chunked), JSON-schema-constrained
// to the same event enum. No ANTHROPIC_API_KEY → returns null and the caller
// keeps those entries as NOTE.

import Anthropic from "@anthropic-ai/sdk";
import { NOTE_EVENTS, type NoteEventValue } from "./notes-parser";

const MODEL = "claude-sonnet-4-6";
const BATCH = 100;

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
        properties: { id: { type: "integer" }, event: { type: "string", enum: [...NOTE_EVENTS] } },
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
      if (Number.isInteger(r.id) && r.id >= 0 && r.id < batch.length && NOTE_EVENTS.includes(r.event)) out[start + r.id] = r.event;
    }
  }
  return out;
}
