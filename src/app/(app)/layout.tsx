import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell/app-shell";

// Written by the sidebar component whenever it is collapsed or expanded.
const SIDEBAR_COOKIE = "sidebar_state";

export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const cookieStore = await cookies();
  const defaultSidebarOpen = cookieStore.get(SIDEBAR_COOKIE)?.value !== "false";

  return <AppShell defaultSidebarOpen={defaultSidebarOpen}>{children}</AppShell>;
}
