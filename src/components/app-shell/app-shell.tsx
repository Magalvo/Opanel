import type { ReactNode } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

import { AppSidebar } from "./app-sidebar";

interface AppShellProps {
  children: ReactNode;
  /** Whether the sidebar starts expanded. Comes from the cookie the sidebar maintains. */
  defaultSidebarOpen: boolean;
}

/** The frame around every signed-in page: sidebar, top bar and the main region. */
export function AppShell({ children, defaultSidebarOpen }: Readonly<AppShellProps>) {
  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={defaultSidebarOpen}>
        <AppSidebar />
        <div className="flex min-h-svh min-w-0 flex-1 flex-col bg-background">
          <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
            <SidebarTrigger />
            <ThemeToggle />
          </header>
          <main className="min-w-0 flex-1 p-6">{children}</main>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  );
}
