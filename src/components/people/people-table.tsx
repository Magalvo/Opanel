"use client";

import { MoreHorizontalIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ManagedAccount } from "@/lib/schemas/accounts";
import { humanRoleSchema } from "@/lib/schemas/permissions";

import { ROLE_LABELS, ROLE_OPTIONS } from "./roles";

const STATUS: Record<
  ManagedAccount["status"],
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  active: { label: "Active", variant: "secondary" },
  invited: { label: "Invited", variant: "outline" },
  deactivated: { label: "Deactivated", variant: "default" },
};

export interface PeopleTableProps {
  people: readonly ManagedAccount[];
  onRoleChange: (person: ManagedAccount, role: ManagedAccount["role"]) => void;
  onDeactivate: (person: ManagedAccount) => void;
  onReactivate: (person: ManagedAccount) => void;
  onCreateLink: (person: ManagedAccount) => void;
}

/** One row per person: who, role, status, last seen and the actions an Admin can take. */
export function PeopleTable({
  people,
  onRoleChange,
  onDeactivate,
  onReactivate,
  onCreateLink,
}: Readonly<PeopleTableProps>) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Person</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Last seen</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {people.map((person) => (
          <TableRow key={person.id}>
            <TableCell>
              <div className="grid">
                <span className="font-medium">{person.name}</span>
                <span className="text-xs text-muted-foreground">{person.email}</span>
              </div>
            </TableCell>
            <TableCell>
              <Select
                value={person.role}
                disabled={person.status === "deactivated"}
                onValueChange={(value) => {
                  const role = humanRoleSchema.safeParse(value);
                  if (role.success && role.data !== person.role) onRoleChange(person, role.data);
                }}
              >
                <SelectTrigger aria-label={`Role of ${person.name}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {ROLE_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </TableCell>
            <TableCell>
              <Badge variant={STATUS[person.status].variant}>{STATUS[person.status].label}</Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {person.lastSeenAt === null ? "Never" : new Date(person.lastSeenAt).toLocaleString()}
            </TableCell>
            <TableCell className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${person.name}`}>
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-56">
                  {person.status === "deactivated" ? (
                    <DropdownMenuItem
                      onSelect={() => {
                        onReactivate(person);
                      }}
                    >
                      Reactivate
                    </DropdownMenuItem>
                  ) : (
                    <>
                      <DropdownMenuItem
                        onSelect={() => {
                          onCreateLink(person);
                        }}
                      >
                        {person.status === "invited"
                          ? "Create a new invitation link"
                          : "Create reset link"}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => {
                          onDeactivate(person);
                        }}
                      >
                        Deactivate
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
