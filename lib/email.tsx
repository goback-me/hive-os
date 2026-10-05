// React in scope: scripts run through tsx use the classic JSX transform.
import React from "react";
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text, render } from "@react-email/components";
import { prisma } from "./prisma";
import { signActionToken } from "./action-token";

// Action emails (Resend: RESEND_API_KEY + EMAIL_FROM). Each has ONE button
// to a deep link in the app, <APP_URL><path>?a=<signed token> (lib/
// action-token.ts), and is logged in EmailLog; the page records the click.
// Unset Resend → nothing is sent (returns false) — the in-app task stays.

export const appUrl = () => process.env.APP_URL || process.env.NEXTAUTH_URL || "";
export const emailConfigured = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

type ActionEmail = {
  to: string[];
  type: string; // EmailLog.type
  clientId: string;
  refIds: string[]; // what the email is about (lead ids, a meeting id) — pinned on the page
  path: string; // where the button goes, e.g. /clients/acme/updates
  subject: string;
  heading: string;
  intro: string;
  lines?: string[];
  button: string;
};

function Template({ heading, intro, lines = [], button, href }: Pick<ActionEmail, "heading" | "intro" | "lines" | "button"> & { href: string }) {
  return (
    <Html>
      <Head />
      <Preview>{intro}</Preview>
      <Body style={{ background: "#f4f4f5", fontFamily: "Helvetica, Arial, sans-serif", margin: 0, padding: "24px 0" }}>
        <Container style={{ background: "#ffffff", borderRadius: 12, padding: 28, maxWidth: 560 }}>
          <Heading as="h2" style={{ margin: "0 0 12px", fontSize: 20, color: "#18181b" }}>{heading}</Heading>
          <Text style={{ fontSize: 15, color: "#3f3f46", lineHeight: "22px" }}>{intro}</Text>
          {lines.length > 0 && (
            <Section style={{ margin: "8px 0 16px" }}>
              {lines.map((l, i) => (
                <Text key={i} style={{ fontSize: 14, color: "#3f3f46", margin: "4px 0", lineHeight: "20px" }}>{l}</Text>
              ))}
            </Section>
          )}
          <Button href={href} style={{ background: "#7c3aed", color: "#ffffff", borderRadius: 8, padding: "12px 20px", fontSize: 15, fontWeight: 700, textDecoration: "none" }}>
            {button}
          </Button>
          <Text style={{ fontSize: 12, color: "#a1a1aa", marginTop: 24 }}>Hive Social · you&apos;ll be asked to sign in if you aren&apos;t already.</Text>
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
  const el = <Template heading={e.heading} intro={e.intro} lines={e.lines} button={e.button} href={href} />;
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
