/**
 * Runs the skill's trigger queries against a real OpenCode session.
 *
 * A trigger query asks one question: given this user request, does the model load the
 * `l4d2-hsmcp` skill? The runner does not grade answers and does not execute the work; it
 * sends a routing probe that forbids file changes, then records every `skill` tool call.
 * That separates description matching from whether the agent can finish the task, which the
 * task evals in `evals.json` cover.
 *
 * Run it with `pnpm eval:triggers`. The report is development output and goes to
 * `.develop-diary/evals/` by default (gitignored), not to `test/` or the skill.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { runOpenCodeSession } from "./opencode-session.js";

interface QueryCase {
  query: string;
  should_trigger: boolean;
  split: string;
}

interface EvalConfig {
  runs?: number;
  queries: QueryCase[];
}

interface ProbeDetail {
  run: number;
  triggered: boolean;
  skillIds: string[];
  tools: string[];
  text: string;
  timedOut: boolean;
  exitCode: number | null;
  seconds: number;
  stderr: string;
}

interface Job {
  entry: QueryCase & { id: number };
  run: number;
}

const root = resolve(import.meta.dirname, "..", "..", "..", "..");
const evalFile = join(root, "skill", "l4d2-hsmcp", "evals", "trigger-queries.json");

const parsed = parseArgs(process.argv.slice(2));
const config = JSON.parse(readFileSync(evalFile, "utf8")) as EvalConfig;
const runs = numberOption(parsed.runs) ?? config.runs ?? 3;
const model = stringOption(parsed.model) ?? "opencode-go/deepseek-v4.1-flash";
const timeoutMs = numberOption(parsed.timeout) ?? 120_000;
const concurrency = numberOption(parsed.concurrency) ?? 2;
const split = stringOption(parsed.split) ?? "all";
const only = numberOption(parsed.only) ?? null;
const out =
  stringOption(parsed.out) ?? join(root, ".develop-diary", "evals", "trigger-report.json");

const queries = config.queries
  .map((entry, index) => ({ ...entry, id: index + 1 }))
  .filter((entry) => split === "all" || entry.split === split)
  .filter((entry) => only == null || entry.id === only);

if (queries.length === 0) {
  console.error("eval-triggers: no query matched the filter");
  process.exit(1);
}

const probe = (query: string): string =>
  "Routing check. Do not carry out the request, do not edit files and do not run commands. " +
  "If one of the available skills applies to it, load that skill now with the skill tool. " +
  "Then answer with one line: the loaded skill ids, or none.\n\n" +
  `Request: ${query}`;

const jobs: Job[] = [];
for (const entry of queries) {
  for (let run = 1; run <= runs; run += 1) jobs.push({ entry, run });
}

const results = new Map<number, ProbeDetail[]>();
let next = 0;

async function worker(): Promise<void> {
  for (;;) {
    const job = jobs[next];
    next += 1;
    if (!job) return;
    const session = await runOpenCodeSession({
      prompt: probe(job.entry.query),
      cwd: root,
      model,
      timeoutMs,
    });
    const detail: ProbeDetail = {
      run: job.run,
      triggered: session.skillIds.some((id) => id.toLowerCase().includes("l4d2-hsmcp")),
      skillIds: session.skillIds,
      tools: session.toolNames,
      text: session.text.slice(0, 400),
      timedOut: session.timedOut,
      exitCode: session.exitCode,
      seconds: session.seconds,
      stderr: session.stderr.slice(0, 400),
    };
    const list = results.get(job.entry.id) ?? [];
    list.push(detail);
    results.set(job.entry.id, list);
    const mark = detail.triggered ? "LOAD" : "miss";
    process.stdout.write(
      `#${String(job.entry.id).padStart(2, "0")} run ${job.run}/${runs} ${mark} ` +
        `${detail.seconds.toFixed(1)}s ${JSON.stringify(detail.skillIds)} ${job.entry.query}\n`,
    );
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));

const report = queries.map((entry) => {
  const list = (results.get(entry.id) ?? []).sort((a, b) => a.run - b.run);
  const triggered = list.filter((item) => item.triggered).length;
  const rate = list.length === 0 ? 0 : triggered / list.length;
  const pass = entry.should_trigger ? rate >= 0.5 : rate < 0.5;
  return {
    id: entry.id,
    query: entry.query,
    shouldTrigger: entry.should_trigger,
    split: entry.split,
    runs: list.length,
    triggered,
    rate,
    pass,
    details: list,
  };
});

const passed = report.filter((item) => item.pass).length;
const summary = {
  model,
  runs,
  split,
  date: new Date().toISOString(),
  total: report.length,
  passed,
  accuracy: report.length === 0 ? 0 : passed / report.length,
  falseNegatives: report
    .filter((item) => item.shouldTrigger && !item.pass)
    .map((item) => item.id),
  falsePositives: report
    .filter((item) => !item.shouldTrigger && !item.pass)
    .map((item) => item.id),
  report,
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

process.stdout.write(
  `\n${passed}/${report.length} queries passed, accuracy ${summary.accuracy.toFixed(2)}; ` +
    `false negatives ${summary.falseNegatives.join(", ") || "none"}; ` +
    `false positives ${summary.falsePositives.join(", ") || "none"}\nReport: ${out}\n`,
);

function parseArgs(argv: string[]): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === undefined || !key.startsWith("--")) continue;
    const value = argv[i + 1];
    const name = key.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    if (value == null || value.startsWith("--")) {
      out[name] = true;
    } else {
      out[name] = /^\d+$/.test(value) ? Number(value) : value;
      i += 1;
    }
  }
  return out;
}

function numberOption(value: string | number | boolean | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function stringOption(value: string | number | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
