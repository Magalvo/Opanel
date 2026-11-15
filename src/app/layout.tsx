import "./globals.css";

import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "Opanel",
  description: "Open-source project management for human teams and AI agents.",
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // The proxy gives every page request its own nonce (WS-041). Reading it makes the layout,
  // and so every page, rendered per request, as a nonce needs.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    // next-themes sets the theme class on <html> before React hydrates, so the server and
    // client markup differ on this one element by design.
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider nonce={nonce}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
