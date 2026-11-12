import type { ReactNode } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AccountSummary } from "@/lib/schemas/auth";

import { AccountMenu } from "./account-menu";
import { AppSidebar } from "./app-sidebar";

interface AppShellProps {
  children: ReactNode;
  /** Whether the sidebar starts expanded. Comes from the cookie the sidebar maintains. */
  defaultSidebarOpen: boolean;
  /** The signed-in account, shown in the account menu. */
  account: AccountSummary;
}

/** The frame around every signed-in page: sidebar, top bar and the main region. */
export function AppShell({ children, defaultSidebarOpen, account }: Readonly<AppShellProps>) {
  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={defaultSidebarOpen}>
        <AppSidebar />
        <div className="flex min-h-svh min-w-0 flex-1 flex-col bg-background">
          <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
            <SidebarTrigger />
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <AccountMenu account={account} />
            </div>
          </header>
          <main className="min-w-0 flex-1 p-6">{children}</main>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  );
}
