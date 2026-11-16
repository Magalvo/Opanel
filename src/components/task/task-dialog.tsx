"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/**
 * The dialog a task opens in over the board (WS-038). Closing it goes back, so Back and
 * Forward close and reopen it.
 */
export function TaskDialog({
  taskKey,
  children,
}: Readonly<{ taskKey: string; children: ReactNode }>) {
  const router = useRouter();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) router.back();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
      >
        <DialogTitle className="sr-only">Task {taskKey}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
