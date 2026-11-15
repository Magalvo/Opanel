import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Project } from "@/lib/schemas/projects";

/** One row per project: its key, its name as a link to the project, and whether it is archived. */
export function ProjectsTable({ projects }: Readonly<{ projects: readonly Project[] }>) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Key</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {projects.map((project) => (
          <TableRow key={project.id}>
            <TableCell className="font-mono text-xs">{project.key}</TableCell>
            <TableCell className="font-medium">
              <Link
                href={`/projects/${project.key}`}
                className="underline-offset-4 hover:underline"
              >
                {project.name}
              </Link>
            </TableCell>
            <TableCell>
              {project.archivedAt === null ? (
                <span className="text-muted-foreground">Active</span>
              ) : (
                <Badge variant="outline">Archived</Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
