// React in scope: scripts run through tsx use the classic JSX transform.
import React from "react";
import { Body, Button, Column, Container, Head, Heading, Hr, Html, Preview, Row, Section, Text, render } from "@react-email/components";
import { prisma } from "./prisma";
import { signActionToken } from "./action-token";

// Action emails (Resend: RESEND_API_KEY + EMAIL_FROM). Each has ONE button
// to a deep link in the app, <APP_URL><path>?a=<signed token> (lib/
// action-token.ts), and is logged in EmailLog; the page records the click.
// Unset Resend → nothing is sent (returns false) — the in-app task stays.
//
// EMAIL_FROM's display name must not match an account in your own Google
// Workspace (e.g. "Hive Social"), or Gmail flags it as impersonation — use
// something like "Hive HQ <updates@notify.hivesocial.agency>".

export const appUrl = () => process.env.APP_URL || process.env.NEXTAUTH_URL || "";
export const emailConfigured = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

// One item in the email's list — a lead and where it's at.
export type EmailRow = { title: string; detail: string; days?: number; flag?: string };

type ActionEmail = {
  to: string[];
  type: string; // EmailLog.type
  clientId: string;
  refIds: string[]; // what the email is about (lead ids, a meeting id) — pinned on the page
  path: string; // where the button goes, e.g. /clients/acme/updates
  subject: string;
  heading: string;
  intro: string;
  rows?: EmailRow[];
  button: string;
  footnote?: string; // why they're getting it
};

// The app's palette (app/globals.css, light theme).
const C = { brand: "#0071E3", ink: "#1D1D1F", muted: "#6E6E73", faint: "#A1A1A6", line: "#E5E5EA", page: "#F5F5F7", card: "#FFFFFF" };
const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

// Days waiting: grey under a week, amber 7–13, red 14+ (same as the app).
function daysTag(days: number) {
  const tone = days >= 14 ? { bg: "#FEE2E2", fg: "#B91C1C" } : days >= 7 ? { bg: "#FEF3C7", fg: "#92400E" } : { bg: "#F2F2F7", fg: C.muted };
  return (
    <span style={{ background: tone.bg, color: tone.fg, borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
      {days} day{days === 1 ? "" : "s"}
    </span>
  );
}

function Template({ heading, intro, rows = [], button, href, footnote }: Pick<ActionEmail, "heading" | "intro" | "rows" | "button" | "footnote"> & { href: string }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{intro}</Preview>
      <Body style={{ background: C.page, fontFamily: font, margin: 0, padding: "32px 12px" }}>
        <Container style={{ maxWidth: 600, margin: "0 auto" }}>
          <Text style={{ margin: "0 0 16px 4px", fontSize: 15, fontWeight: 700, color: C.ink, letterSpacing: "-0.01em" }}>
            <span style={{ color: C.brand }}>●</span> Hive HQ <span style={{ color: C.faint, fontWeight: 500 }}>by Hive Social</span>
          </Text>

          <Section style={{ background: C.card, borderRadius: 16, padding: "32px 32px 28px", border: `1px solid ${C.line}` }}>
            <Heading as="h1" style={{ margin: "0 0 10px", fontSize: 22, lineHeight: "28px", color: C.ink, letterSpacing: "-0.02em" }}>{heading}</Heading>
            <Text style={{ margin: "0 0 22px", fontSize: 15, lineHeight: "23px", color: C.muted }}>{intro}</Text>

            {rows.length > 0 && (
              <Section style={{ border: `1px solid ${C.line}`, borderRadius: 12, margin: "0 0 26px" }}>
                {rows.map((r, i) => (
                  <Row key={i} style={{ borderTop: i ? `1px solid ${C.line}` : undefined }}>
                    <Column style={{ padding: "12px 16px" }}>
                      <Text style={{ margin: 0, fontSize: 15, fontWeight: 600, color: C.ink, lineHeight: "20px" }}>{r.title}</Text>
                      <Text style={{ margin: "2px 0 0", fontSize: 13, color: C.muted, lineHeight: "18px" }}>
                        {r.detail}
                        {r.flag && <span style={{ color: "#B91C1C", fontWeight: 600 }}> · {r.flag}</span>}
                      </Text>
                    </Column>
                    {r.days != null && <Column style={{ padding: "12px 16px", width: 90, textAlign: "right" }}>{daysTag(r.days)}</Column>}
                  </Row>
                ))}
              </Section>
            )}

            <Button href={href} style={{ background: C.brand, color: "#ffffff", borderRadius: 10, padding: "14px 26px", fontSize: 15, fontWeight: 700, textDecoration: "none", display: "inline-block" }}>
              {button} →
            </Button>
            <Text style={{ margin: "14px 0 0", fontSize: 13, color: C.faint }}>You&apos;ll be asked to sign in to Hive HQ if you aren&apos;t already.</Text>
          </Section>

          <Hr style={{ border: "none", margin: "20px 0 0" }} />
          <Text style={{ margin: "0 4px", fontSize: 12, lineHeight: "18px", color: C.faint }}>
            {footnote ?? "You're getting this because Hive Social manages your leads in Hive HQ."}
            <br />
            Hive Social · Hive HQ
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export async function sendActionEmail(e: ActionEmail): Promise<boolean> {
  const to = Array.from(new Set(e.to.filter(Boolean)));
  if (!emailConfigured() || !to.length) return false;
  const actionToken = signActionToken({ type: e.type, clientId: e.clientId, refIds: e.refIds });
  const href = `${appUrl()}${e.path}?a=${actionToken}`;
  const el = <Template heading={e.heading} intro={e.intro} rows={e.rows} button={e.button} href={href} footnote={e.footnote} />;
  const [html, text] = await Promise.all([render(el), render(el, { plainText: true })]);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject: e.subject, html, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  await prisma.emailLog.create({ data: { to, type: e.type, clientId: e.clientId, refIds: e.refIds, actionToken } });
  return true;
}

// The email's link was opened (first time only).
export async function recordEmailClick(token: string | null | undefined) {
  if (!token) return;
  await prisma.emailLog.updateMany({ where: { actionToken: token, clickedAt: null }, data: { clickedAt: new Date() } }).catch(() => {});
}
