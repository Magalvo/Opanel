// Fails once an advisory that `pnpm audit` is told to ignore has a fix published, so the
// ignore cannot outlive it (WS-061). Run by the Dependency audit workflow:
// `pnpm exec tsx scripts/check-ignored-advisories.ts`, with GH_TOKEN set.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { z } from "zod";

const GHSA = /^\s+-\s+(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})\s*$/;

/** The ids listed under `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`. */
export function ignoredGhsas(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s+ignoreGhsas:\s*$/.test(line));
  if (start === -1) return [];
  const ids: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const match = GHSA.exec(line);
    if (!match?.[1]) break;
    ids.push(match[1]);
  }
  return ids;
}

const advisorySchema = z.object({
  ghsa_id: z.string(),
  vulnerabilities: z.array(z.object({ first_patched_version: z.string().nullable() })),
});

export type Advisory = z.infer<typeof advisorySchema>;

/** The ids of the advisories that have a patched version for any vulnerability. */
export function fixedAdvisories(advisories: Advisory[]): string[] {
  return advisories
    .filter((advisory) =>
      advisory.vulnerabilities.some((vulnerability) => vulnerability.first_patched_version),
    )
    .map((advisory) => advisory.ghsa_id);
}

async function fetchAdvisory(id: string, token: string): Promise<Advisory> {
  const response = await fetch(`https://api.github.com/advisories/${id}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub answered ${String(response.status)} for ${id}.`);
  }
  return advisorySchema.parse(await response.json());
}

async function main(): Promise<void> {
  const token = z.string().min(1, "GH_TOKEN is not set.").parse(process.env.GH_TOKEN);
  const ids = ignoredGhsas(readFileSync("pnpm-workspace.yaml", "utf8"));
  const advisories = await Promise.all(ids.map((id) => fetchAdvisory(id, token)));
  const fixed = fixedAdvisories(advisories);
  for (const id of fixed) {
    console.error(`A fix exists for ${id}: upgrade, then remove the ignore.`);
  }
  if (fixed.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.warn(`Ignored advisories without a fix: ${ids.length > 0 ? ids.join(", ") : "none"}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
