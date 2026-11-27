/**
 * Runs the skill's trigger queries against a real OpenCode session.
 *
 * A trigger query asks one question: given this user request, does the model load the
 * `l4d2-hsmcp` skill? The runner does not grade answers and does not execute the work; it
 * sends a routing probe that forbids file changes, then reads the session's JSON events and
 * records every `skill` tool call. That separates description matching from whether the agent
 * can finish the task, which the task evals in `evals.json` cover.
 *
 * Run it with `pnpm eval:triggers`. The report is development output and goes to
 * `.develop-diary/evals/` by default (gitignored), not to `test/` or the skill.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

interface QueryCase {
  query: string;
  should_trigger: boolean;
  split: string;
}

interface EvalConfig {
  runs?: number;
  queries: QueryCase[];
}

interface ProbeResult {
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

interface EventPart {
  type?: string;
  tool?: string;
  id?: string;
  name?: string;
  text?: string;
  state?: { input?: { id?: unknown; skill?: unknown } };
}

const root = resolve(import.meta.dirname, "..", "..", "..", "..");
const evalFile = join(root, "skill", "l4d2-hsmcp", "evals", "trigger-queries.json");
const opencode =
  process.env.OPENCODE_BIN ??
  join(
    process.env.APPDATA ?? "",
    "npm",
    "node_modules",
    "@opencode",
    "cli",
    "bin",
    "opencode.exe",
  );

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

const results = new Map<number, ProbeResult[]>();
let next = 0;

async function worker(): Promise<void> {
  for (;;) {
    const job = jobs[next];
    next += 1;
    if (!job) return;
    const result = await runProbe(job.entry, job.run);
    const list = results.get(job.entry.id) ?? [];
    list.push(result);
    results.set(job.entry.id, list);
    const mark = result.triggered ? "LOAD" : "miss";
    process.stdout.write(
      `#${String(job.entry.id).padStart(2, "0")} run ${job.run}/${runs} ${mark} ` +
        `${result.seconds.toFixed(1)}s ${JSON.stringify(result.skillIds)} ${job.entry.query}\n`,
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

function runProbe(entry: QueryCase, run: number): Promise<ProbeResult> {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const child = spawn(
      opencode,
      ["run", "--archived", "--format", "json", "--model", model, probe(entry.query)],
      { cwd: root, env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );

    const skillIds: string[] = [];
    const tools: string[] = [];
    let text = "";
    let buffer = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    const consume = (line: string): void => {
      const trimmed = line.trim();
      if (trimmed === "") return;
      let event: { part?: EventPart } & EventPart;
      try {
        event = JSON.parse(trimmed) as { part?: EventPart } & EventPart;
      } catch {
        return;
      }
      const part = event.part ?? event;
      if (part.type === "tool" && part.tool === "skill") {
        const id = part.state?.input?.id ?? part.state?.input?.skill;
        if (typeof id === "string") skillIds.push(id);
      } else if (part.type === "skill") {
        const id = part.id ?? part.name;
        if (typeof id === "string") skillIds.push(id);
      } else if (part.type === "tool") {
        if (typeof part.tool === "string") tools.push(part.tool);
      } else if (part.type === "text" && typeof part.text === "string") {
        text += part.text;
      }
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        consume(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const finish = (code: number | null): void => {
      clearTimeout(timer);
      if (buffer !== "") consume(buffer);
      resolvePromise({
        run,
        triggered: skillIds.some((id) => id.toLowerCase().includes("l4d2-hsmcp")),
        skillIds,
        tools,
        text: text.slice(0, 400),
        timedOut,
        exitCode: code,
        seconds: (Date.now() - started) / 1000,
        stderr: stderr.slice(0, 400),
      });
    };

    child.on("error", () => finish(-1));
    child.on("close", (code) => finish(code));
  });
}
