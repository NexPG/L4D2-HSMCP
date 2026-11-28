/**
 * Runs the skill's task evals against a real OpenCode session.
 *
 * The trigger runner answers "does the description fire?". This one answers the other half:
 * given a real request, does the agent load the skill and produce the artifact the eval
 * describes? Every case runs in its own `workspaces/` directory, and the checks are
 * deterministic: a file exists, a JSON field has a value, or the final answer names a
 * concept. The prose assertions stay in `evals.json` for a human, because keyword checks
 * cannot judge a diagnosis.
 *
 * Run it with `pnpm eval:tasks`, optionally `--case 2` or `--model provider/model` and
 * `--without-skill`. The no-skill run sits in a temporary directory outside the repository,
 * registers only the MCP server and sets `L4D2_HSMCP_NO_SKILL=1`; the skill check is skipped so
 * the report compares the non-skill checks. A run downloads nothing and changes nothing outside
 * `workspaces/`, but cases 1 and 3 are real
 * imports and compiles and can take minutes.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runOpenCodeSession } from "./opencode-session.js";

interface FileCheck {
  kind: "file";
  name?: string;
  suffix?: string;
  jsonPath?: string;
  equals?: unknown;
  minLength?: number;
}

interface TextCheck {
  kind: "text";
  any: string[];
}

interface ToolCheck {
  kind: "tool";
  any: string[];
}

interface SkillCheck {
  kind: "skill";
}

type Check = FileCheck | TextCheck | ToolCheck | SkillCheck;

interface TaskCase {
  id: number;
  prompt: string;
  expected_output: string;
  assertions: string[];
  workspace: string;
  timeoutMs?: number;
  checks: Check[];
}

interface EvalConfig {
  skill_name: string;
  evals: TaskCase[];
}

interface CheckResult {
  kind: string;
  pass: boolean;
  detail: string;
}

const root = resolve(import.meta.dirname, "..", "..", "..", "..");
const evalFile = join(root, "skill", "l4d2-hsmcp", "evals", "evals.json");
const parsed = parseArgs(process.argv.slice(2));
const config = JSON.parse(readFileSync(evalFile, "utf8")) as EvalConfig;
const model = stringOption(parsed.model) ?? "opencode-go/deepseek-v4.1-flash";
const only = numberOption(parsed.case) ?? null;
const timeoutOverride = numberOption(parsed.timeout);
const withoutSkill = parsed.withoutSkill === true;
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const out =
  stringOption(parsed.out) ??
  join(
    root,
    ".develop-diary",
    "evals",
    `task-report-${stamp}${withoutSkill ? "-noskill" : ""}.json`,
  );

const cases = config.evals.filter((entry) => only == null || entry.id === only);
if (cases.length === 0) {
  console.error("eval-tasks: no case matched --case");
  process.exit(1);
}

const results = [];

for (const testCase of cases) {
  // A no-skill run must sit outside the repository: OpenCode walks up from the session
  // directory and would otherwise find the root opencode.json and the .opencode skill link.
  const workspace = withoutSkill
    ? mkdtempSync(join(tmpdir(), `l4d2-eval-noskill-${testCase.id}-`))
    : join(root, "workspaces", `${testCase.workspace}-${stamp}`);
  mkdirSync(workspace, { recursive: true });
  if (withoutSkill) writeNoSkillConfig(workspace);

  const prompt =
    `${testCase.prompt}\n\n` +
    `Работай только в этой директории: ${workspace}. ` +
    "Передавай инструментам абсолютные пути внутри неё и не меняй файлы за её пределами.";

  process.stdout.write(`#${testCase.id} ${testCase.workspace} -> ${workspace}\n`);
  const session = await runOpenCodeSession({
    prompt,
    cwd: workspace,
    model,
    timeoutMs: timeoutOverride ?? testCase.timeoutMs ?? 300_000,
  });

  const files = walk(workspace);
  const checked = testCase.checks.map((check) =>
    evaluate(check, session, files, withoutSkill),
  );
  const pass = checked.every((item) => item.pass);
  const skillLoaded = session.skillIds.some((id) => id.toLowerCase().includes("l4d2-hsmcp"));
  results.push({
    case: testCase.id,
    workspace,
    prompt: testCase.prompt,
    expectedOutput: testCase.expected_output,
    assertions: testCase.assertions,
    skillLoaded,
    skillIds: session.skillIds,
    tools: session.toolNames,
    toolInputs: session.toolInputs,
    seconds: session.seconds,
    timedOut: session.timedOut,
    exitCode: session.exitCode,
    text: session.text,
    stderr: session.stderr,
    files,
    checks: checked,
    pass,
  });

  const mark = pass ? "PASS" : "FAIL";
  process.stdout.write(
    `#${testCase.id} ${mark} skill=${
      withoutSkill ? "skipped" : skillLoaded ? "loaded" : "not loaded"
    } ${session.seconds.toFixed(1)}s checks=${checked.filter((item) => item.pass).length}/${checked.length}\n`,
  );
  for (const item of checked) {
    if (!item.pass) process.stdout.write(`   - ${item.kind}: ${item.detail}\n`);
  }
}

const passed = results.filter((item) => item.pass).length;
const summary = {
  skill: config.skill_name,
  withoutSkill,
  model,
  date: new Date().toISOString(),
  total: results.length,
  passed,
  results,
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

process.stdout.write(
  `\n${passed}/${results.length} task evals passed; report: ${out}\n`,
);
process.exitCode = passed === results.length ? 0 : 1;

function evaluate(
  check: Check,
  session: { skillIds: string[]; text: string; toolInputs: string[] },
  files: string[],
  withoutSkill: boolean,
): CheckResult {
  if (check.kind === "skill") {
    if (withoutSkill) {
      return { kind: "skill", pass: true, detail: "skipped: no-skill run" };
    }
    const loaded = session.skillIds.some((id) => id.toLowerCase().includes("l4d2-hsmcp"));
    return {
      kind: "skill",
      pass: loaded,
      detail: loaded ? "the skill was loaded" : "the skill was not loaded",
    };
  }

  if (check.kind === "tool") {
    const haystack = session.toolInputs.join("\n").toLowerCase();
    const hit = check.any.find((phrase) => haystack.includes(phrase.toLowerCase()));
    return {
      kind: "tool",
      pass: hit !== undefined,
      detail:
        hit !== undefined
          ? `a tool call names "${hit}"`
          : `no tool call names ${JSON.stringify(check.any)}`,
    };
  }

  if (check.kind === "text") {
    const haystack = session.text.toLowerCase();
    const hit = check.any.find((phrase) => haystack.includes(phrase.toLowerCase()));
    return {
      kind: "text",
      pass: hit !== undefined,
      detail:
        hit !== undefined
          ? `found "${hit}"`
          : `none of ${JSON.stringify(check.any)} appears in the answer`,
    };
  }

  const matches = files.filter((file) => {
    const name = basename(file);
    if (check.name !== undefined) return name === check.name;
    if (check.suffix !== undefined) return name.endsWith(check.suffix);
    return true;
  });

  if (matches.length === 0) {
    return {
      kind: "file",
      pass: false,
      detail: `no ${check.name ?? `*${check.suffix}`} under the workspace`,
    };
  }

  if (check.jsonPath === undefined) {
    return { kind: "file", pass: true, detail: `found ${matches[0]}` };
  }

  for (const file of matches) {
    let value: unknown;
    try {
      value = readJsonPath(JSON.parse(readFileSync(file, "utf8")) as unknown, check.jsonPath);
    } catch {
      continue;
    }
    if (check.equals !== undefined) {
      if (JSON.stringify(value) === JSON.stringify(check.equals)) {
        return {
          kind: "file",
          pass: true,
          detail: `${basename(file)} ${check.jsonPath} = ${JSON.stringify(value)}`,
        };
      }
      continue;
    }
    if (check.minLength !== undefined) {
      if (Array.isArray(value) && value.length >= check.minLength) {
        return {
          kind: "file",
          pass: true,
          detail: `${basename(file)} ${check.jsonPath} has ${value.length} item(s)`,
        };
      }
    }
  }

  return {
    kind: "file",
    pass: false,
    detail: `${basename(matches[0]!)} has no ${check.jsonPath} matching ${JSON.stringify(
      check.equals ?? `length >= ${check.minLength}`,
    )}`,
  };
}

function readJsonPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === ".git" || name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

/**
 * A temporary OpenCode config with the MCP server and no skills.
 *
 * The session runs outside the repository, so OpenCode cannot walk up to the root
 * `opencode.json` or the `.opencode/skills` link. The bootstrap pins `L4D2_HSMCP_REPO` and
 * imports the absolute launcher, so the tools still work while the skill is absent.
 */
function writeNoSkillConfig(dir: string): void {
  const launcher = pathToFileURL(join(root, "bin", "l4d2-hsmcp.mjs")).href;
  const bootstrap =
    `process.env.L4D2_HSMCP_REPO=${JSON.stringify(root)};` +
    "process.env.L4D2_HSMCP_NO_SKILL='1';" +
    `import(${JSON.stringify(launcher)})`;
  const config = {
    $schema: "https://opencode.ai/config.json",
    mcp: {
      servers: {
        "l4d2-hsmcp": {
          type: "local",
          command: ["node", "-e", bootstrap],
        },
      },
    },
  };
  writeFileSync(join(dir, "opencode.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

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
