"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Epic } from "@/lib/schemas/epics";

import { ProgressBar } from "./progress-bar";

/** One row per epic: its title (opens it), status, dates and progress. */
export function EpicsTable({
  epics,
  onOpen,
}: Readonly<{ epics: readonly Epic[]; onOpen: (epic: Epic, opener: HTMLElement) => void }>) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Epic</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Start</TableHead>
          <TableHead>Target</TableHead>
          <TableHead>Progress</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {epics.map((epic) => (
          <TableRow key={epic.id}>
            <TableCell className="font-medium">
              <Button
                variant="ghost"
                // The link variant's blue is below 4.5:1 on the dark background (axe).
                className="h-auto p-0 text-left font-medium whitespace-normal underline underline-offset-4 hover:bg-transparent"
                onClick={(event) => {
                  onOpen(epic, event.currentTarget);
                }}
              >
                {epic.title}
              </Button>
            </TableCell>
            <TableCell>
              <Badge variant={epic.status === "open" ? "secondary" : "outline"}>
                {epic.status === "open" ? "Open" : "Closed"}
              </Badge>
            </TableCell>
            <TableCell className="tabular-nums">{epic.startDate ?? "—"}</TableCell>
            <TableCell className="tabular-nums">{epic.targetDate ?? "—"}</TableCell>
            <TableCell>
              <ProgressBar
                title={epic.title}
                doneTasks={epic.progress.doneTasks}
                totalTasks={epic.progress.totalTasks}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
