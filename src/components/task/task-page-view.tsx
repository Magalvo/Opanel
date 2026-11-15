"use client";

import { useRouter } from "next/navigation";

import { TaskDetail, type TaskDetailProps } from "./task-detail";

/** The task as a page of its own (a direct visit, a reload, a shared link). */
export function TaskPageView(props: Readonly<Omit<TaskDetailProps, "onLeave">>) {
  const router = useRouter();
  const projectKey = props.task.key.slice(0, props.task.key.lastIndexOf("-"));

  return (
    <TaskDetail
      {...props}
      onLeave={() => {
        router.push(`/projects/${projectKey}`);
      }}
    />
  );
}
