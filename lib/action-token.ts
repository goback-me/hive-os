import { createHmac, timingSafeEqual } from "crypto";

// The ?a= on an email's button link: a signed note of what the email was
// about (which client, which leads / meeting), valid 14 days. It is NOT a
// login — the page still needs a Clerk session and checks the viewer can
// see that client; the token only says what to highlight, and lets the
// click be recorded on the EmailLog. HMAC-SHA256 with ACTION_TOKEN_SECRET.

export type ActionPayload = { type: string; clientId: string; refIds: string[]; exp: number };
export const ACTION_TOKEN_DAYS = 14;

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const secretOf = (secret?: string) => {
  const s = secret ?? process.env.ACTION_TOKEN_SECRET;
  if (!s) throw new Error("ACTION_TOKEN_SECRET is not set. Add it to .env");
  return s;
};
const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest();

export function signActionToken(p: Omit<ActionPayload, "exp">, opts: { now?: Date; secret?: string } = {}) {
  const payload: ActionPayload = { ...p, exp: (opts.now ?? new Date()).getTime() + ACTION_TOKEN_DAYS * 86_400_000 };
  const body = b64(JSON.stringify(payload));
  return `${body}.${b64(sign(body, secretOf(opts.secret)))}`;
}

// The payload, or null if it's malformed, tampered with or expired.
export function verifyActionToken(token: string | null | undefined, opts: { now?: Date; secret?: string } = {}): ActionPayload | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  let secret: string;
  try {
    secret = secretOf(opts.secret);
  } catch {
    return null;
  }
  const want = sign(body, secret);
  const got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as ActionPayload;
    if (typeof p.exp !== "number" || p.exp < (opts.now ?? new Date()).getTime()) return null;
    if (typeof p.clientId !== "string" || !Array.isArray(p.refIds)) return null;
    return p;
  } catch {
    return null;
  }
}
