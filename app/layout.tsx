import type { ReactNode } from "react";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import AppHeader from "@/components/AppHeader";

export const metadata = {
  title: "Hive OS",
  description: "HiveSocial agency command center",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body-md text-on-surface">
        <Sidebar />
        <main className="ml-64 min-h-screen bg-background">
          <AppHeader />
          {children}
        </main>
      </body>
    </html>
  );
}
