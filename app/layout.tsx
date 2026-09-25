import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata = {
  title: "Hive HQ",
  description: "Hive Social's client portal — leads, ad performance, revenue, and referrals in one place",
  icons: { icon: { url: "/logo.webp", type: "image/webp" }, apple: "/logo.webp" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider signInUrl="/login" signInFallbackRedirectUrl="/dashboard">
      <html lang="en">
        <head>
          {/* Runs before first paint so the correct theme is set immediately —
              without this, the page always paints light first, then flips to
              dark once React hydrates and the ThemeToggle effect runs. */}
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){try{var s=localStorage.getItem("theme");var d=s==="dark"||(s===null&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.classList.add("dark");}catch(e){}})();`,
            }}
          />
          {/* Fixed-size box + visibility:hidden on .material-symbols-outlined
              (globals.css) means icons stay invisible (but reserve their
              exact space, so nothing shifts) until this script confirms the
              icon font is actually ready to render — then reveals them all
              at once instead of showing raw fallback letters one by one. */}
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){function reveal(){document.documentElement.classList.add("fonts-loaded");}try{if(document.fonts&&document.fonts.load){document.fonts.load('24px "Material Symbols Outlined"').then(reveal).catch(reveal);setTimeout(reveal,1500);}else{reveal();}}catch(e){reveal();}})();`,
            }}
          />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link
            href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
            rel="stylesheet"
          />
          <link
            href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
            rel="stylesheet"
          />
        </head>
        <body className="font-body" style={{ fontFamily: "var(--font-body)" }}>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}