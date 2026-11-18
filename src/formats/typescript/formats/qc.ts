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

interface Macro {
  params: string[];
  body: Token[];
}

/**
 * `$definemacro` / `$M args` at token level.
 *
 * scriplib's macro body is line-oriented: the header is `$definemacro Name Param... \\`,
 * and body lines continue while they end with `\\`; the first line that does not end with
 * it is the last body line. The marker itself is not part of the body. An invocation
 * `$Name a b` replaces itself with the body, substituting `$Param$` tokens. This is the
 * parameter substitution.
 */
function expandMacros(
  tokens: readonly Token[],
  macros: Map<string, Macro>,
  path: string,
  depth = 0,
): { tokens: Token[]; diagnostics: QcDiagnostic[] } {
  const diagnostics: QcDiagnostic[] = [];
  if (depth > 32) {
    diagnostics.push({
      severity: "error",
      rule: "qc-macro-recursion",
      message: "macro expansion nested more than 32 levels; a macro probably calls itself",
      file: path,
      line: null,
    });
    return { tokens: [...tokens], diagnostics };
  }

  const out: Token[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (token.text.toLowerCase() === "$definemacro") {
      const name = tokens[i + 1];
      if (!name || name.line !== token.line) {
        diagnostics.push({
          severity: "error",
          rule: "qc-definemacro-incomplete",
          message: "$definemacro needs a name and a closing \\\\ on the same line",
          file: path,
          line: token.line,
        });
        out.push(token);
        i += 1;
        continue;
      }
      const params: string[] = [];
      let at = i + 2;
      while (at < tokens.length && tokens[at]!.line === token.line && tokens[at]!.text !== "\\\\") {
        params.push(tokens[at]!.text);
        at += 1;
      }
      if (at >= tokens.length || tokens[at]!.text !== "\\\\") {
        diagnostics.push({
          severity: "error",
          rule: "qc-definemacro-incomplete",
          message: `$definemacro ${name.text} has no closing \\\\ before the line ends`,
          file: path,
          line: token.line,
        });
        i = at;
        continue;
      }
      at += 1; // the header marker

      const body: Token[] = [];
      while (at < tokens.length) {
        const line = tokens[at]!.line;
        const lineTokens: Token[] = [];
        while (at < tokens.length && tokens[at]!.line === line) {
          lineTokens.push(tokens[at]!);
          at += 1;
        }
        const continued = lineTokens.at(-1)?.text === "\\\\";
        for (const item of lineTokens) {
          if (item.text !== "\\\\") body.push(item);
        }
        if (!continued) break;
      }
      if (body.length === 0) {
        diagnostics.push({
          severity: "warning",
          rule: "qc-definemacro-empty",
          message: `$definemacro ${name.text} has an empty body`,
          file: path,
          line: token.line,
        });
      }
      macros.set(name.text.replace(/^\$/, "").toLowerCase(), { params, body });
      i = at;
      continue;
    }

    if (!token.quoted && token.text.startsWith("$") && !token.text.includes("$", 1)) {
      const macro = macros.get(token.text.slice(1).toLowerCase());
      if (macro) {
        const args: string[] = [];
        let at = i + 1;
        while (
          at < tokens.length &&
          tokens[at]!.line === token.line &&
          tokens[at]!.text !== "{" &&
          tokens[at]!.text !== "}"
        ) {
          args.push(tokens[at]!.text);
          at += 1;
        }
        const values = new Map<string, string>();
        macro.params.forEach((param, index) => values.set(param.toLowerCase(), args[index] ?? ""));
        const replacement: Token[] = macro.body.map((item) => {
          const text = item.text.replace(/\$([A-Za-z0-9_]+)\$/g, (whole, name: string) => {
            const value = values.get(name.toLowerCase());
            return value === undefined ? whole : value;
          });
          return { ...item, text, line: token.line };
        });
        const nested = expandMacros(replacement, macros, path, depth + 1);
        out.push(...nested.tokens);
        diagnostics.push(...nested.diagnostics);
        i = at;
        continue;
      }
    }

    out.push(token);
    i += 1;
  }

  return { tokens: out, diagnostics };
}

/**
 * `$definevariable` and `$Name$` expansion, at token level, before statements are grouped.
 *
 * scriplib expands a variable only in a **bare** token: `$attachment "a" "$Bone$Hand"` keeps
 * the literal text, while `$bonesaveframe $Bone$Pelvis position` becomes
 * `ValveBiped.Bip01_Pelvis`. The closing `$` is part of the syntax. The first definition of
 * `second` still produces `first.mdl` — so a redefinition is reported and ignored rather
 * than silently replacing the first.
 *
 * Variables live across `$include`, which is why `loadQc` passes one map to every file.
 */
function expandVariables(
  tokens: readonly Token[],
  variables: Map<string, string>,
  path: string,
): { tokens: Token[]; diagnostics: QcDiagnostic[] } {
  const out: Token[] = [];
  const diagnostics: QcDiagnostic[] = [];
  const unknown = new Set<string>();
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i]!;
    if (token.text.toLowerCase() === "$definevariable") {
      const name = tokens[i + 1];
      const value = tokens[i + 2];
      if (
        name === undefined ||
        value === undefined ||
        name.line !== token.line ||
        value.line !== token.line ||
        name.text === "{" ||
        name.text === "}"
      ) {
        diagnostics.push({
          severity: "error",
          rule: "qc-definevariable-incomplete",
          message: "$definevariable needs a name and a value on the same line",
          file: path,
          line: token.line,
        });
        out.push(token);
        i += 1;
        continue;
      }
      const key = name.text.toLowerCase();
      if (variables.has(key)) {
        diagnostics.push({
          severity: "warning",
          rule: "qc-variable-redefined",
          message: `$definevariable ${name.text} is defined twice; studiomdl keeps the first value`,
          file: path,
          line: token.line,
        });
      } else {
        variables.set(key, value.text);
      }
      i += 3;
      continue;
    }

    if (!token.quoted && token.text.includes("$")) {
      let text = token.text;
      // A value may itself contain `$Other$`; expand to a fixed point, bounded so a cycle
      // between two variables is a diagnostic rather than a hang.
      for (let round = 0; round < 8; round += 1) {
        let changed = false;
        text = text.replace(/\$([A-Za-z0-9_]+)\$/g, (whole, name: string) => {
          const value = variables.get(name.toLowerCase());
          if (value === undefined) {
            if (!unknown.has(name.toLowerCase())) {
              unknown.add(name.toLowerCase());
              diagnostics.push({
                severity: "error",
                rule: "qc-unknown-variable",
                message: `$${name}$ is not defined; studiomdl would stop here`,
                file: path,
                line: token.line,
              });
            }
            return whole;
          }
          changed = true;
          return value;
        });
        if (!changed) break;
      }
      out.push({ ...token, text });
      i += 1;
      continue;
    }

    out.push(token);
    i += 1;
  }

  return { tokens: out, diagnostics };
}

/**
 * Groups tokens into statements.
 *
 * A statement is one command and everything on its line, plus a block when the next token is
 * `{`. This is how every QC that ships with a Source game is written; a command that spans a
 * line break without a block is not something studiomdl accepts either.
 */
export function parseQc(
  source: string,
  path = "<text>",
  variables: Map<string, string> = new Map(),
  macros: Map<string, Macro> = new Map(),
): QcFile {
  const raw = lexQc(source);
  const macroExpansion = expandMacros(raw, macros, path);
  const expansion = expandVariables(macroExpansion.tokens, variables, path);
  const tokens = expansion.tokens;
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
  file.diagnostics.push(...macroExpansion.diagnostics, ...expansion.diagnostics);
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
 * Seeds macro definitions from a whole include tree before the files are parsed.
 *
 * `scriplib` reads an `$include` at the point it appears, so a macro defined in a `.qci`
 * is usable by the root file after the include. This reader parses a file before following
 * its includes, so without a pre-pass the root would see `$Macro` as an unknown variable.
 * The pre-pass is deliberately one-directional and bounded: it collects definitions in
 * include order and does not try to reorder statements.
 */
function seedMacros(
  path: string,
  macros: Map<string, Macro>,
  chain: string[],
  depth: number,
): void {
  if (depth > 16 || chain.includes(path) || !existsSync(path)) return;
  const tokens = lexQc(readFileSync(path, "utf8"));
  expandMacros(tokens, macros, path);
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i]!.text.toLowerCase() !== "$include") continue;
    const line = tokens[i]!.line;
    for (let at = i + 1; at < tokens.length && tokens[at]!.line === line; at += 1) {
      const target = resolve(dirname(path), tokens[at]!.text.replace(/\\/g, "/"));
      seedMacros(target, macros, [...chain, path], depth + 1);
    }
  }
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
  const variables = new Map<string, string>();
  const macros = new Map<string, Macro>();
  seedMacros(absolute, macros, [], 0);
  const root = parseQc(readFileSync(absolute, "utf8"), absolute, variables, macros);

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
        const child = parseQc(readFileSync(target, "utf8"), target, variables, macros);
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
