import Link from "next/link";

import { Sidebar, SidebarContent, SidebarHeader } from "@/components/ui/sidebar";

export function AppSidebar() {
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
        {/* Navigation items arrive with the first real screens (WT-02, WT-03). */}
        <nav aria-label="Main" className="flex-1" />
      </SidebarContent>
    </Sidebar>
  );
}
