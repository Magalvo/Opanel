import { UsersIcon } from "lucide-react";
import Link from "next/link";

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export function AppSidebar({ canManageAccounts }: Readonly<{ canManageAccounts: boolean }>) {
  return (
    <Sidebar>
      <SidebarHeader>
        <Link
          href="/"
          className="flex h-8 items-center gap-2 rounded-md px-2 text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <span
            aria-hidden="true"
            className="flex size-6 items-center justify-center rounded-md bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground"
          >
            O
          </span>
          Opanel
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {/* More items arrive with the first screens of WT-03. */}
        <nav aria-label="Main" className="flex-1">
          {canManageAccounts && (
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link href="/people">
                    <UsersIcon aria-hidden="true" />
                    People
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          )}
        </nav>
      </SidebarContent>
    </Sidebar>
  );
}
