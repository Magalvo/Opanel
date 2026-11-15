"use client";

import { useRouter } from "next/navigation";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

import { TaskDetail, type TaskDetailProps } from "./task-detail";

/**
 * The task over the board, when it is reached from a card (the intercepted route). Closing it,
 * or going Back, returns to the board, which was never unmounted.
 */
export function TaskDialog(props: Readonly<Omit<TaskDetailProps, "onLeave">>) {
  const router = useRouter();

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) router.back();
      }}
    >
      <DialogContent className="max-h-[90vh] w-full overflow-y-auto sm:max-w-3xl">
        <DialogTitle className="sr-only">{`Task ${props.task.key}`}</DialogTitle>
        <DialogDescription className="sr-only">
          The details and the comments of the task.
        </DialogDescription>
        <TaskDetail
          {...props}
          onLeave={() => {
            router.back();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
