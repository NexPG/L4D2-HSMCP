/**
 * `.qc` — the text a model is compiled from.
 *
 * `run_studiomdl` could compile a QC and `read_model_info` could read the result, so the
 * gap was exactly in the middle: nothing could read, validate or produce the file itself. An
 * agent asked to make a prop had to emit QC text blind and find out from `studiomdl` whether
 * it was well formed.
 *
 * The grammar is `scriplib`'s, which is not KeyValues and not a config file: a line starting
 * with `$` is a command, its arguments are quoted or bare, and some commands take a `{ }`
 * block of further commands. Three details come from Valve's `scriplib.h` / `scriplib.cpp`:
 *
 * * `\` is a literal backslash, not an escape — `$cdmaterials "models\weapons\"` is a real
 *   spelling and the trailing backslash closes nothing;
 * * `//` starts a comment, and `\r` is whitespace;
 * * `$include` nests, and `MAX_INCLUDES` is 16. A file that includes itself is an error, not
 *   a hang, and the chain is reported rather than silently truncated.
 *
 * This reader is deliberately not a full studiomdl: it parses structure, follows includes and
 * checks the handful of things whose absence stops a compile. It does not pretend to know
 * every `$command` that exists, because a wrong "unknown command" is worse than none.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export type QcSeverity = "error" | "warning";

export interface QcDiagnostic {
  severity: QcSeverity;
  rule: string;
  message: string;
  file: string;
  line: number | null;
}

export interface QcStatement {
  /** `$modelname`, or a block-inner command such as `event`. */
  command: string;
  args: string[];
  block?: QcStatement[];
  line: number;
}

export interface QcFile {
  path: string;
  statements: QcStatement[];
  /** Absolute paths of every include, in the order they were opened. */
  includes: string[];
  /** Parsed includes, in the same order. Missing ones are recorded in the diagnostics. */
  included: QcFile[];
  diagnostics: QcDiagnostic[];
}

interface Token {
  text: string;
  quoted: boolean;
  line: number;
}

const WHITESPACE = new Set([" ", "\t", "\r", "\n"]);

/** Splits a QC into tokens. `{` and `}` are their own tokens; comments and newlines go. */
export function lexQc(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;

  while (i < source.length) {
    const c = source[i]!;
    if (c === "\n") {
      line += 1;
      i += 1;
      continue;
    }
    if (WHITESPACE.has(c)) {
      i += 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "{" || c === "}") {
      tokens.push({ text: c, quoted: false, line });
      i += 1;
      continue;
    }
    if (c === '"') {
      const start = i + 1;
      let end = start;
      // No escapes: a backslash is a backslash, and the string ends at the next quote.
      while (end < source.length && source[end] !== '"') {
        if (source[end] === "\n") line += 1;
        end += 1;
      }
      tokens.push({ text: source.slice(start, end), quoted: true, line });
      i = end + 1;
      continue;
    }
    const start = i;
    while (i < source.length && !WHITESPACE.has(source[i]!) && source[i] !== "{" && source[i] !== "}") {
      if (source[i] === "/" && source[i + 1] === "/") break;
      i += 1;
    }
    tokens.push({ text: source.slice(start, i), quoted: false, line });
  }

  return tokens;
}

/**
 * Groups tokens into statements.
 *
 * A statement is one command and everything on its line, plus a block when the next token is
 * `{`. This is how every QC that ships with a Source game is written; a command that spans a
 * line break without a block is not something studiomdl accepts either.
 */
export function parseQc(source: string, path = "<text>"): QcFile {
  const tokens = lexQc(source);
  let i = 0;

  const parseStatements = (untilBrace: boolean): QcStatement[] => {
    const out: QcStatement[] = [];
    while (i < tokens.length) {
      const token = tokens[i]!;
      if (token.text === "}") {
        if (untilBrace) {
          i += 1;
          return out;
        }
        // A stray `}` outside a block: skip it rather than letting every later line become
        // part of a command that was never opened.
        i += 1;
        continue;
      }
      if (token.text === "{") {
        // A block with no command before it. Studiomdl would read this as part of the
        // previous command; keeping it separate makes the report say where it is.
        i += 1;
        out.push({ command: "{", args: [], block: parseStatements(true), line: token.line });
        continue;
      }

      const statement: QcStatement = { command: token.text, args: [], line: token.line };
      i += 1;
      while (i < tokens.length) {
        const next = tokens[i]!;
        if (next.text === "{" || next.text === "}" || next.line !== statement.line) break;
        statement.args.push(next.text);
        i += 1;
      }
      if (i < tokens.length && tokens[i]!.text === "{") {
        i += 1;
        statement.block = parseStatements(true);
      }
      out.push(statement);
    }
    return out;
  };

  const statements = parseStatements(false);
  const file: QcFile = { path, statements, includes: [], included: [], diagnostics: [] };
  const local = validateStatements(statements, path);
  file.diagnostics.push(...local);
  return file;
}

/** Collects every statement, including those inside blocks. */
export function walkQc(statements: readonly QcStatement[]): QcStatement[] {
  const out: QcStatement[] = [];
  for (const statement of statements) {
    out.push(statement);
    if (statement.block) out.push(...walkQc(statement.block));
  }
  return out;
}

function validateStatements(statements: readonly QcStatement[], file: string): QcDiagnostic[] {
  const diagnostics: QcDiagnostic[] = [];
  const all = walkQc(statements);
  const byCommand = (name: string): QcStatement[] =>
    all.filter((s) => s.command.toLowerCase() === name);

  const modelName = byCommand("$modelname");
  if (modelName.length === 0) {
    diagnostics.push({
      severity: "error",
      rule: "qc-no-modelname",
      message: "no $modelname; studiomdl has nowhere to write the .mdl and refuses",
      file,
      line: null,
    });
  } else if (modelName.length > 1) {
    diagnostics.push({
      severity: "warning",
      rule: "qc-repeated-modelname",
      message: `${modelName.length} $modelname commands; the last one wins in studiomdl, which is rarely what was meant`,
      file,
      line: modelName[1]!.line,
    });
  }
  for (const statement of modelName) {
    const name = statement.args[0] ?? "";
    if (!name) continue;
    if (!name.toLowerCase().startsWith("models/")) {
      diagnostics.push({
        severity: "warning",
        rule: "qc-modelname-outside-models",
        message: `$modelname "${name}" does not start with models/; the engine only loads models from there`,
        file,
        line: statement.line,
      });
    }
    if (!name.toLowerCase().endsWith(".mdl")) {
      diagnostics.push({
        severity: "warning",
        rule: "qc-modelname-without-mdl",
        message: `$modelname "${name}" does not end in .mdl`,
        file,
        line: statement.line,
      });
    }
  }

  if (byCommand("$body").length === 0 && byCommand("$bodygroup").length === 0) {
    diagnostics.push({
      severity: "error",
      rule: "qc-no-body",
      message: "no $body and no $bodygroup; the model has no geometry",
      file,
      line: null,
    });
  }
  if (byCommand("$cdmaterials").length === 0) {
    diagnostics.push({
      severity: "warning",
      rule: "qc-no-cdmaterials",
      message: "no $cdmaterials; the model compiles without textures and draws as a checkerboard",
      file,
      line: null,
    });
  }

  const sequences = byCommand("$sequence");
  const seen = new Map<string, QcStatement>();
  for (const statement of sequences) {
    const name = (statement.args[0] ?? "").toLowerCase();
    if (!name) continue;
    const previous = seen.get(name);
    if (previous) {
      diagnostics.push({
        severity: "warning",
        rule: "qc-duplicate-sequence",
        message: `$sequence "${statement.args[0]}" is declared twice; the second replaces the first`,
        file,
        line: statement.line,
      });
    } else {
      seen.set(name, statement);
    }
  }

  for (const statement of byCommand("$attachment")) {
    if (statement.args.length < 2) {
      diagnostics.push({
        severity: "warning",
        rule: "qc-attachment-incomplete",
        message: "$attachment needs a name and a bone; an incomplete one is ignored at compile time",
        file,
        line: statement.line,
      });
    }
  }

  return diagnostics;
}

export interface LoadQcOptions {
  /** `MAX_INCLUDES` in scriplib. */
  maxDepth?: number;
}

/**
 * Reads a QC and every file it includes.
 *
 * A missing include is an error about the file that asked for it, not a crash: a QC with one
 * absent `.qci` is a common state on a machine where somebody copied half a model.
 */
export function loadQc(path: string, options: LoadQcOptions = {}): QcFile {
  const maxDepth = options.maxDepth ?? 16;
  const absolute = resolve(path);
  const root = parseQc(readFileSync(absolute, "utf8"), absolute);

  const loadIncludes = (file: QcFile, chain: string[], depth: number): void => {
    for (const statement of file.statements) {
      if (statement.command.toLowerCase() !== "$include") continue;
      for (const arg of statement.args) {
        const target = resolve(dirname(file.path), arg.replace(/\\/g, "/"));
        if (chain.includes(target)) {
          file.diagnostics.push({
            severity: "error",
            rule: "qc-include-cycle",
            message: `$include "${arg}" closes a cycle: ${[...chain, target].join(" -> ")}`,
            file: file.path,
            line: statement.line,
          });
          continue;
        }
        if (!existsSync(target)) {
          file.diagnostics.push({
            severity: "error",
            rule: "qc-include-missing",
            message: `$include "${arg}" resolves to ${target}, which does not exist`,
            file: file.path,
            line: statement.line,
          });
          continue;
        }
        if (depth >= maxDepth) {
          file.diagnostics.push({
            severity: "error",
            rule: "qc-include-too-deep",
            message: `$include depth limit ${maxDepth} reached at ${target}; scriplib's MAX_INCLUDES is 16`,
            file: file.path,
            line: statement.line,
          });
          continue;
        }
        const child = parseQc(readFileSync(target, "utf8"), target);
        file.includes.push(target);
        file.included.push(child);
        loadIncludes(child, [...chain, target], depth + 1);
      }
    }
  };

  loadIncludes(root, [absolute], 0);
  return root;
}

/** Every include, recursively, in opening order. */
export function flattenQc(file: QcFile): QcFile[] {
  return [file, ...file.included.flatMap(flattenQc)];
}

/** The model name from the root file's `$modelname`, or null. */
export function qcModelName(file: QcFile): string | null {
  for (const statement of walkQc(file.statements)) {
    if (statement.command.toLowerCase() === "$modelname" && statement.args[0]) {
      return statement.args[0].replace(/^[\\/]+/, "");
    }
  }
  return null;
}

export interface QcSequence {
  name: string;
  smd: string | null;
  fps: number | null;
  activity: string | null;
  /** `activity <name> <weight>`: one entry per declaration. */
  activities: Array<{ name: string; weight: number }>;
  line: number;
}

/** `$sequence` declarations as data, with the arguments studiomdl reads positionally. */
export function qcSequences(file: QcFile): QcSequence[] {
  const out: QcSequence[] = [];
  for (const statement of flattenQc(file).flatMap((f) => walkQc(f.statements))) {
    if (statement.command.toLowerCase() !== "$sequence") continue;
    const [name, ...rest] = statement.args;
    if (!name) continue;
    const activities: Array<{ name: string; weight: number }> = [];
    let fps: number | null = null;
    let smd: string | null = null;

    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i]!;
      if (arg.toLowerCase() === "fps" && rest[i + 1] !== undefined) {
        const value = Number(rest[i + 1]);
        if (Number.isFinite(value)) fps = value;
        i += 1;
      } else if (arg.toLowerCase() === "activity" && rest[i + 1] !== undefined) {
        const weight = rest[i + 2] !== undefined && Number.isFinite(Number(rest[i + 2])) ? Number(rest[i + 2]) : 1;
        activities.push({ name: rest[i + 1]!, weight });
        i += 2;
      } else if (smd === null && /\.(smd|dmx)$/i.test(arg)) {
        smd = arg;
      }
    }
    out.push({ name, smd, fps, activity: activities[0]?.name ?? null, activities, line: statement.line });
  }
  return out;
}

export interface QcSpec {
  modelname: string;
  cdmaterials?: string[];
  body?: Array<{ name: string; smd: string }>;
  surfaceprop?: string;
  staticprop?: boolean;
  sequences?: Array<{
    name: string;
    smd: string;
    fps?: number;
    activity?: string;
    activityWeight?: number;
    /** Extra arguments, appended verbatim: `loop`, `hidden`, `predelay 0.2` ... */
    args?: string[];
    /** Lines inside the sequence's block: events, ikrules. */
    block?: string[];
  }>;
  attachments?: Array<{ name: string; bone: string; position?: [number, number, number] }>;
  /** Raw QC lines appended last, for anything this builder does not model. */
  extra?: string[];
}

function quote(value: string): string {
  if (/["\r\n]/.test(value)) {
    throw new Error(`a QC value cannot contain a quote or a newline: ${JSON.stringify(value)}`);
  }
  return `"${value}"`;
}

/**
 * Builds a minimal, well-formed QC.
 *
 * It is intentionally small: `$modelname`, at least one `$body`, the materials, and whatever
 * sequences and attachments the caller described. Everything else goes through `extra`, so
 * this builder never silently drops a command it does not know.
 */
export function buildQc(spec: QcSpec): string {
  if (!spec.modelname) throw new Error("a QC needs a $modelname");
  if (spec.body !== undefined && spec.body.length === 0) {
    throw new Error("`body: []` would produce a model with no geometry; omit it to write only the header");
  }

  const lines: string[] = [`$modelname ${quote(spec.modelname)}`];
  for (const body of spec.body ?? []) {
    lines.push(`$body ${quote(body.name)} ${quote(body.smd)}`);
  }
  if (spec.cdmaterials && spec.cdmaterials.length > 0) {
    lines.push(`$cdmaterials ${spec.cdmaterials.map(quote).join(" ")}`);
  }
  if (spec.surfaceprop) lines.push(`$surfaceprop ${quote(spec.surfaceprop)}`);
  if (spec.staticprop) lines.push("$staticprop");

  for (const attachment of spec.attachments ?? []) {
    const position = attachment.position ?? [0, 0, 0];
    lines.push(
      `$attachment ${quote(attachment.name)} ${quote(attachment.bone)} ` +
        `position ${position.join(" ")}`,
    );
  }

  for (const sequence of spec.sequences ?? []) {
    const args = [quote(sequence.name), quote(sequence.smd)];
    if (sequence.fps !== undefined) args.push("fps", String(sequence.fps));
    if (sequence.activity) args.push("activity", sequence.activity, String(sequence.activityWeight ?? 1));
    args.push(...(sequence.args ?? []));
    if (sequence.block && sequence.block.length > 0) {
      lines.push(`$sequence ${args.join(" ")}`);
      lines.push("{");
      for (const line of sequence.block) lines.push(`\t${line}`);
      lines.push("}");
    } else {
      lines.push(`$sequence ${args.join(" ")}`);
    }
  }

  lines.push(...(spec.extra ?? []));
  lines.push("");
  return `${lines.join("\n")}\n`;
}
