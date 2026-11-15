"use client";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TeamSummary } from "@/lib/schemas/teams";

export interface TeamsTableProps {
  teams: readonly TeamSummary[];
  canManage: boolean;
  onOpen: (team: TeamSummary, opener: HTMLElement) => void;
}

/** One row per team: its name, how many members it has, and a button that opens it. */
export function TeamsTable({ teams, canManage, onOpen }: Readonly<TeamsTableProps>) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Team</TableHead>
          <TableHead>Members</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {teams.map((team) => (
          <TableRow key={team.id}>
            <TableCell className="font-medium">{team.name}</TableCell>
            <TableCell>{team.memberCount}</TableCell>
            <TableCell className="text-right">
              <Button
                variant="outline"
                size="sm"
                aria-label={`${canManage ? "Manage" : "Members of"} ${team.name}`}
                onClick={(event) => {
                  onOpen(team, event.currentTarget);
                }}
              >
                {canManage ? "Manage" : "Members"}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
