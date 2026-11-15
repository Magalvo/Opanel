"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Applies the `dark` class on <html>. Follows the operating system until the user picks
 * a theme, then remembers the choice in localStorage. `nonce` lets its inline script run
 * under the Content Security Policy (WS-041).
 */
export function ThemeProvider({
  children,
  nonce,
}: Readonly<{ children: ReactNode; nonce?: string | undefined }>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...(nonce === undefined ? {} : { nonce })}
    >
      {children}
    </NextThemesProvider>
  );
}
