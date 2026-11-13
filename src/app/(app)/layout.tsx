import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell/app-shell";
import { can } from "@/server/auth/actor";
import { requireAccount } from "@/server/auth/session";
import { summarize } from "@/server/services/sign-in";

// Written by the sidebar component whenever it is collapsed or expanded.
const SIDEBAR_COOKIE = "sidebar_state";

export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  // The real check, with the database. The proxy only looks at the cookie, and a layout is
  // not re-rendered on every navigation, so data is protected by the API (WS-017).
  const { actor, account } = await requireAccount();
  const cookieStore = await cookies();
  const defaultSidebarOpen = cookieStore.get(SIDEBAR_COOKIE)?.value !== "false";

  return (
    <AppShell
      defaultSidebarOpen={defaultSidebarOpen}
      account={summarize(account)}
      canManageAccounts={can(actor, "accounts:manage")}
    >
      {children}
    </AppShell>
  );
}
