// `pnpm check` (WS-103): the three static checks of the quality gate, in parallel. Each
// check's output is held back and printed as one block when it finishes, so the outputs
// never interleave. Each check can still be run on its own (`pnpm lint`, ...).
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

/** The package.json scripts `pnpm check` runs. */
export const CHECKS = ["typecheck", "lint", "format:check"] as const;

/** How one check ended: its exit code, its stdout and stderr together, and its duration. */
export interface CheckRun {
  code: number;
  output: string;
  ms: number;
}

function header(name: string, run: CheckRun): string {
  const seconds = (run.ms / 1000).toFixed(1);
  const outcome = run.code === 0 ? "passed" : `failed (exit ${String(run.code)})`;
  return `── ${name}: ${outcome} in ${seconds} s ──\n`;
}

/**
 * Starts every check at once and prints each one's block as it finishes, then a summary
 * line. Resolves to the exit code for the whole: 0 when every check passed, else 1.
 */
export async function runChecks(
  names: readonly string[],
  run: (name: string) => Promise<CheckRun>,
  print: (text: string) => void,
): Promise<number> {
  const failed = new Set<string>();
  await Promise.all(
    names.map(async (name) => {
      const result = await run(name);
      if (result.code !== 0) failed.add(name);
      print(header(name, result) + result.output);
    }),
  );

  const failedInOrder = names.filter((name) => failed.has(name));
  if (failedInOrder.length > 0) {
    print(`Failed: ${failedInOrder.join(", ")}`);
    return 1;
  }
  print(`All passed: ${names.join(", ")}`);
  return 0;
}

/** Runs one package.json script with `node --run`, collecting its output. */
function runScript(name: string): Promise<CheckRun> {
  const start = performance.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--run", name], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    const finish = (code: number, extra = "") => {
      resolve({
        code,
        output: Buffer.concat(chunks).toString("utf8") + extra,
        ms: performance.now() - start,
      });
    };
    child.on("error", (error) => {
      finish(1, `${error.message}\n`);
    });
    child.on("close", (code) => {
      finish(code ?? 1);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runChecks(CHECKS, runScript, (text) => {
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
  });
}
