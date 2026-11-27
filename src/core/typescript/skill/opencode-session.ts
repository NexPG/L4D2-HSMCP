/**
 * One OpenCode CLI session, reduced to what the evaluations need.
 *
 * The trigger runner and the task runner both send a prompt to a real session and read the
 * JSON event stream. Keeping the spawn, the stdin rule and the event parsing here means the
 * two evaluations measure the same thing and a change to the stream is fixed once. The
 * session does not grade anything; it returns the skill loads, the tool names and the final
 * text, and each runner applies its own checks.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

export interface SessionRun {
  /** Every id passed to the `skill` tool, in call order. */
  skillIds: string[];
  /** Every tool the model called, in order, including `skill` and `execute`. */
  toolNames: string[];
  /** Each tool call's input as text, so a check can see which MCP tool was named. */
  toolInputs: string[];
  /** The concatenated assistant text, not the tool results. */
  text: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  seconds: number;
}

interface EventPart {
  type?: string;
  tool?: string;
  id?: string;
  name?: string;
  text?: string;
  state?: { input?: { id?: unknown; skill?: unknown } };
}

export function opencodeBinary(): string {
  return (
    process.env.OPENCODE_BIN ??
    join(
      process.env.APPDATA ?? "",
      "npm",
      "node_modules",
      "@opencode",
      "cli",
      "bin",
      "opencode.exe",
    )
  );
}

export function runOpenCodeSession(options: {
  prompt: string;
  cwd: string;
  model: string;
  timeoutMs: number;
}): Promise<SessionRun> {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const child = spawn(
      opencodeBinary(),
      ["run", "--standalone", "--archived", "--format", "json", "--model", options.model, options.prompt],
      {
        cwd: options.cwd,
        env: process.env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const skillIds: string[] = [];
    const toolNames: string[] = [];
    const toolInputs: string[] = [];
    let text = "";
    let stderr = "";
    let buffer = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);

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
      if (part.type === "tool") {
        if (typeof part.tool === "string") toolNames.push(part.tool);
        toolInputs.push(JSON.stringify(part.state?.input ?? {}).slice(0, 4000));
        if (part.tool === "skill") {
          const id = part.state?.input?.id ?? part.state?.input?.skill;
          if (typeof id === "string") skillIds.push(id);
        }
      } else if (part.type === "skill") {
        const id = part.id ?? part.name;
        if (typeof id === "string") skillIds.push(id);
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
        skillIds,
        toolNames,
        toolInputs,
        text,
        stderr: stderr.slice(0, 2000),
        exitCode: code,
        timedOut,
        seconds: (Date.now() - started) / 1000,
      });
    };

    child.on("error", () => finish(-1));
    child.on("close", (code) => finish(code));
  });
}
