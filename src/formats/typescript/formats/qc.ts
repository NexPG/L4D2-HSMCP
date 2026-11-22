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
import { dirname, resolve } from "node:path";

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
 * shape the compiler's own macro files use, and the tests below pin both the continuation and
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
 * a name wins in studiomdl — `$definevariable Name first` then `second` still produces
 * `first.mdl` — so a redefinition is reported and ignored rather
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
/** Strips the UTF-8 BOM a Windows editor leaves behind; scriplib skips it, the lexer does not. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseQc(
  source: string,
  path = "<text>",
  variables: Map<string, string> = new Map(),
  macros: Map<string, Macro> = new Map(),
  declaredBones?: ReadonlySet<string>,
): QcFile {
  const raw = lexQc(stripBom(source));
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
  file.diagnostics.push(...validateGrammar(statements, path, declaredBones));
  return file;
}

/**
 * The commands a QC may contain, and the shape of their arguments.
 *
 * This is deliberately a catalogue of *structure*, not of every semantic: a QC that uses a
 * command correctly must not be warned about, and a command the catalogue does not know is a
 * warning rather than an error. The alternative -- pretending to know all 137 studiomdl
 * commands and rejecting a valid one because it was not on a list -- is worse than the
 * occasional unknown-command note.
 */
const QC_COMMANDS = new Set([
  "$modelname", "$body", "$bodygroup", "$bodygrouppreset", "$model", "$cdmaterials",
  "$cdtexture", "$surfaceprop", "$sequence", "$animation", "$attachment", "$definebone",
  "$hbox", "$hboxset", "$skipboneinbbox", "$ikchain", "$ikautoplaylock", "$jigglebone",
  "$keyvalues", "$texturegroup", "$poseparameter", "$bbox", "$cbox", "$contents",
  "$illumposition", "$eyeposition", "$staticprop", "$mostlyopaque", "$bonemerge",
  "$unlockdefinebones", "$opaque", "$translucent", "$cliptotextures", "$scale", "$include",
  "$includemodel", "$pushd", "$popd", "$cd", "$definevariable", "$definemacro",
  "$maxeyedeflection", "$forcephonemecrossfade", "$eyeball", "$eyelid", "$mouth",
  "$flexcontroller", "$flexrule", "$flex", "$flexpair", "$animation", "$animblocksize",
  "$sectionframes", "$bonesaveframe", "$skyname", "$flags", "$contents", "$mass",
  "$concave", "$concaveperjoint", "$maxconvexpieces", "$rootbone", "$jointmerge",
  "$jointconstrain", "$jointrules", "$sequence", "$weightlist",
  // Commands that only appear in decompiled QCs, written by the compiler's own feature set.
  "$ambientboost", "$casttextureshadows", "$collisionjoints", "$collisionmodel",
  "$collisiontext", "$constantdirectionallight", "$controller", "$damping",
  "$declareanimation", "$declaresequence", "$donotcastshadows", "$drag",
  "$externaltextures", "$fadedist", "$gamma", "$hgroup", "$inertia", "$jointcollide",
  "$jointcontents", "$jointdamping", "$jointinertia", "$jointmassbias",
  "$jointrotdamping", "$jointsurfaceprop", "$limitrotation", "$mirrorbone",
  "$noforcedfade", "$noselfcollisions", "$obsolete", "$origin", "$pivot",
  "$proceduralbones", "$renamebone", "$rollingdrag", "$root", "$rotdamping",
  "$screenalign", "$sequencegroup", "$sequencegroupsize", "$shadowlod", "$texrendermode",
  "$upaxis", "$worldalign", "$lod",
]);

/** The command names the structural validator knows; exported for `read_qc` to report. */
export const qcKnownCommands: ReadonlySet<string> = QC_COMMANDS;

function grammarDiagnostic(
  severity: QcSeverity,
  rule: string,
  message: string,
  file: string,
  line: number | null,
): QcDiagnostic {
  return { severity, rule, message, file, line };
}

function isNumber(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "" && Number.isFinite(Number(value));
}

function checkNumbers(
  statement: QcStatement,
  args: readonly string[],
  count: number,
  rule: string,
  message: string,
  file: string,
  diagnostics: QcDiagnostic[],
): void {
  if (args.length !== count || !args.every(isNumber)) {
    diagnostics.push(grammarDiagnostic("error", rule, message, file, statement.line));
  }
}

function checkSequenceBlock(
  statement: QcStatement,
  file: string,
  diagnostics: QcDiagnostic[],
): void {
  const numeric = new Set(["fps", "predelay", "weight", "fadein", "fadeout", "transition"]);
  for (const inner of statement.block ?? []) {
    const command = inner.command.toLowerCase();
    if (numeric.has(command) && inner.args.length > 0 && !isNumber(inner.args[0])) {
      diagnostics.push(
        grammarDiagnostic(
          "error",
          "qc-sequence-number",
          `$sequence "${statement.args[0] ?? ""}" block: ${inner.command} needs a number`,
          file,
          inner.line,
        ),
      );
    }
    if (command === "fps" && inner.args.length > 0 && isNumber(inner.args[0]) && Number(inner.args[0]) <= 0) {
      diagnostics.push(
        grammarDiagnostic(
          "error",
          "qc-sequence-fps",
          `$sequence "${statement.args[0] ?? ""}" block: fps must be greater than zero, got ${inner.args[0]}`,
          file,
          inner.line,
        ),
      );
    }
    if (command === "event" && inner.args.length > 0) {
      const frame = inner.args[inner.args.length - 1]!;
      if (isNumber(frame) && Number(frame) < 0) {
        diagnostics.push(
          grammarDiagnostic(
            "warning",
            "qc-sequence-event-frame",
            `$sequence "${statement.args[0] ?? ""}" block: event ${inner.args.join(" ")} has a negative frame`,
            file,
            inner.line,
          ),
        );
      }
    }
    if (command === "event" && inner.args.length < 1) {
      diagnostics.push(
        grammarDiagnostic(
          "warning",
          "qc-sequence-event",
          `$sequence "${statement.args[0] ?? ""}" block: event has no type`,
          file,
          inner.line,
        ),
      );
    }
    if (command === "activity") {
      if (inner.args.length < 1) {
        diagnostics.push(
          grammarDiagnostic(
            "warning",
            "qc-sequence-activity",
            `$sequence "${statement.args[0] ?? ""}" block: activity has no name`,
            file,
            inner.line,
          ),
        );
      } else if (inner.args.length > 1 && !isNumber(inner.args[1])) {
        diagnostics.push(
          grammarDiagnostic(
            "error",
            "qc-sequence-activity-weight",
            `$sequence "${statement.args[0] ?? ""}" block: activity ${inner.args[0]} needs a numeric weight, got ${inner.args[1]}`,
            file,
            inner.line,
          ),
        );
      }
    }
    if ((command === "loop" || command === "snap") && inner.args.length > 0) {
      diagnostics.push(
        grammarDiagnostic(
          "warning",
          "qc-sequence-flag",
          `$sequence "${statement.args[0] ?? ""}" block: ${inner.command} is a flag and takes no value`,
          file,
          inner.line,
        ),
      );
    }
    if (command === "node" && inner.args.length < 1) {
      diagnostics.push(
        grammarDiagnostic(
          "warning",
          "qc-sequence-node",
          `$sequence "${statement.args[0] ?? ""}" block: node has no attachment name`,
          file,
          inner.line,
        ),
      );
    }
  }
}

function validateCommand(
  statement: QcStatement,
  file: string,
  diagnostics: QcDiagnostic[],
): void {
  const command = statement.command.toLowerCase();
  const args = statement.args;
  const fail = (rule: string, message: string, severity: QcSeverity = "error") => {
    diagnostics.push(grammarDiagnostic(severity, rule, message, file, statement.line));
  };

  if (!command.startsWith("$")) {
    // A bare command is meaningful only inside a block; the block owner checked it.
    return;
  }
  if (!QC_COMMANDS.has(command)) {
    fail(
      "qc-unknown-command",
      `unknown QC command ${statement.command}; this reader validates structure, not every ` +
        "studiomdl command, so check the spelling before assuming it is wrong",
      "warning",
    );
    return;
  }

  switch (command) {
    case "$modelname":
      if (args.length !== 1) fail("qc-command-args", "$modelname needs exactly one path");
      break;
    case "$body":
      if (args.length !== 2) fail("qc-command-args", "$body needs a name and an SMD/DMX file");
      break;
    case "$bodygroup":
      if (args.length < 1) fail("qc-command-args", "$bodygroup needs a name");
      if (!statement.block) {
        fail("qc-command-block", "$bodygroup needs a { studio/blank ... } block", "warning");
      }
      for (const inner of statement.block ?? []) {
        const innerCommand = inner.command.toLowerCase();
        if (innerCommand === "studio" && inner.args.length < 1) {
          fail("qc-bodygroup-studio", "studio needs a model file", "warning");
        }
        if (innerCommand === "blank" && inner.args.length > 1) {
          // `blank` takes no argument at all; the decompiler writes the bare form for an
          // empty alternative and studiomdl accepts it. An index is tolerated because some
          // hand-written QCs use it as a comment-like marker.
          fail("qc-bodygroup-blank", "blank takes no argument (a body index is tolerated)", "warning");
        }
      }
      break;
    case "$model":
      if (args.length < 2) fail("qc-command-args", "$model needs a name and a file");
      break;
    case "$cdmaterials":
    case "$cdtexture":
      if (args.length < 1) fail("qc-command-args", `${statement.command} needs at least one directory`);
      break;
    case "$surfaceprop":
      if (args.length !== 1) fail("qc-command-args", "$surfaceprop needs exactly one name");
      break;
    case "$sequence":
    case "$animation":
      if (args.length < 1) {
        fail("qc-command-args", `${statement.command} needs a name`);
        break;
      }
      if (args.length < 2 && !statement.block) {
        fail(
          "qc-sequence-source",
          `${statement.command} "${args[0]}" has no SMD/DMX file and no block`,
          "warning",
        );
      }
      if (command === "$sequence") checkSequenceBlock(statement, file, diagnostics);
      break;
    case "$attachment":
      if (args.length < 2) {
        fail("qc-attachment-incomplete", "$attachment needs a name and a bone", "warning");
        break;
      }
      for (let index = 2; index < args.length; index += 1) {
        const key = args[index]!.toLowerCase();
        if (key === "position" || key === "rotate") {
          if (!args.slice(index + 1, index + 4).every(isNumber)) {
            fail("qc-attachment-number", `$attachment ${key} needs three numbers`, "warning");
          }
        }
      }
      break;
    case "$definebone":
      if (args.length < 2) {
        fail("qc-command-args", "$definebone needs a bone and a parent");
        break;
      }
      if (args.length > 2 && !args.slice(2).every(isNumber)) {
        fail("qc-definebone-number", "$definebone values after the parent must be numbers", "warning");
      }
      break;
    case "$bbox":
    case "$cbox":
      checkNumbers(
        statement,
        args,
        6,
        "qc-bbox-number",
        `${statement.command} needs six numbers (min xyz and max xyz)`,
        file,
        diagnostics,
      );
      break;
    case "$eyeposition":
    case "$illumposition":
      checkNumbers(
        statement,
        args,
        3,
        "qc-position-number",
        `${statement.command} needs three numbers`,
        file,
        diagnostics,
      );
      break;
    case "$contents":
      if (args.length !== 1) fail("qc-command-args", "$contents needs one value", "warning");
      break;
    case "$hbox":
      if (args.length < 2) {
        fail("qc-command-args", "$hbox needs a group and a bone", "warning");
      } else if (!args.slice(2).every(isNumber)) {
        fail("qc-hbox-number", "$hbox bounds must be numbers", "warning");
      }
      break;
    case "$hboxset":
      if (args.length !== 1) fail("qc-command-args", "$hboxset needs a name", "warning");
      break;
    case "$ikchain":
      if (args.length < 1) fail("qc-command-args", "$ikchain needs a name", "warning");
      break;
    case "$jigglebone":
      if (args.length < 1) fail("qc-command-args", "$jigglebone needs a bone", "warning");
      if (!statement.block) fail("qc-command-block", "$jigglebone needs a block", "warning");
      break;
    case "$keyvalues":
      if (!statement.block) fail("qc-command-block", "$keyvalues needs a block", "warning");
      break;
    case "$texturegroup":
      if (args.length < 1) fail("qc-command-args", "$texturegroup needs a name", "warning");
      if (!statement.block) fail("qc-command-block", "$texturegroup needs a block", "warning");
      break;
    case "$poseparameter":
      if (args.length < 1) fail("qc-command-args", "$poseparameter needs a name", "warning");
      break;
    case "$scale":
    case "$maxeyedeflection":
    case "$forcephonemecrossfade":
      checkNumbers(
        statement,
        args,
        1,
        "qc-number",
        `${statement.command} needs one number`,
        file,
        diagnostics,
      );
      break;
    case "$include":
      if (args.length < 1) fail("qc-command-args", "$include needs a file", "warning");
      break;
    case "$pushd":
    case "$cd":
      if (args.length !== 1) fail("qc-command-args", `${statement.command} needs one directory`, "warning");
      break;
    case "$popd":
      if (args.length !== 0) fail("qc-command-args", "$popd takes no arguments", "warning");
      break;
    case "$definevariable":
      if (args.length < 2) fail("qc-command-args", "$definevariable needs a name and a value");
      break;
    case "$definemacro":
      if (args.length < 2) fail("qc-command-args", "$definemacro needs a name and a closing \\\\");
      break;
    case "$staticprop":
    case "$mostlyopaque":
    case "$unlockdefinebones":
    case "$opaque":
    case "$translucent":
    case "$cliptotextures":
      if (args.length !== 0) {
        fail("qc-command-args", `${statement.command} takes no arguments`, "warning");
      }
      break;
    case "$bonemerge":
      if (args.length > 1) fail("qc-command-args", "$bonemerge takes at most one name", "warning");
      break;
    default:
      break;
  }
}

/**
 * Walks the statement tree and checks command structure.
 *
 * `$keyvalues` is deliberately opaque: its block is KeyValues, not QC, and flagging
 * `prop_data` as an unknown QC command was the first version's most common false positive.
 * Blocks owned by `$jigglebone`, `$texturegroup` and `$model` are likewise left to the
 * compiler: their inner vocabulary is large and version-specific.
 */
function validateGrammar(
  statements: readonly QcStatement[],
  file: string,
  declaredBones?: ReadonlySet<string>,
): QcDiagnostic[] {
  const diagnostics: QcDiagnostic[] = [];
  // These blocks have their own vocabulary (KeyValues, the sequence block, a bodygroup's
  // studio/blank, jigglebone constants). The owner validates what it understands and the
  // rest is left to studiomdl; treating every inner token as a QC command is the false
  // positive this list exists to prevent.
  const SKIP_INNER = new Set([
    "$keyvalues",
    "$sequence",
    "$bodygroup",
    "$jigglebone",
    "$texturegroup",
    "$model",
    "$animation",
    "$eyeball",
    "$eyelid",
    "$mouth",
  ]);
  const walk = (items: readonly QcStatement[], parent: string | null): void => {
    for (const statement of items) {
      if (parent !== null && SKIP_INNER.has(parent)) continue;
      validateCommand(statement, file, diagnostics);
      if (statement.block) walk(statement.block, statement.command.toLowerCase());
    }
  };
  walk(statements, null);
  checkSkeleton(statements, file, diagnostics, declaredBones);
  return diagnostics;
}

/**
 * `$definebone` is a graph, and the compiler only complains late and vaguely. A parent that
 * is not declared and a cycle are the two mistakes that turn into an unhelpful studiomdl
 * failure, so they are reported here with the bone that caused them.
 */
function checkSkeleton(
  statements: readonly QcStatement[],
  file: string,
  diagnostics: QcDiagnostic[],
  declaredElsewhere?: ReadonlySet<string>,
): void {
  const bones = walkQc(statements).filter(
    (statement) => statement.command.toLowerCase() === "$definebone" && statement.args.length >= 2,
  );
  if (bones.length === 0) return;
  const parentOf = new Map<string, string>();
  for (const bone of bones) {
    const name = bone.args[0]!;
    const parent = bone.args[1]!;
    if (parentOf.has(name)) {
      diagnostics.push(
        grammarDiagnostic(
          "warning",
          "qc-definebone-duplicate",
          `$definebone ${name} is declared more than once; the later one wins`,
          file,
          bone.line,
        ),
      );
    }
    parentOf.set(name, parent);
  }
  for (const bone of bones) {
    const name = bone.args[0]!;
    const parent = bone.args[1]!;
    if (parent !== "" && !parentOf.has(parent) && !declaredElsewhere?.has(parent.toLowerCase())) {
      diagnostics.push(
        grammarDiagnostic(
          "warning",
          "qc-definebone-parent",
          `$definebone ${name} names parent ${parent}, which no $definebone in this file declares`,
          file,
          bone.line,
        ),
      );
    }
  }
  for (const bone of bones) {
    const start = bone.args[0]!;
    const seen = new Set<string>([start]);
    let current = parentOf.get(start) ?? "";
    while (current !== "") {
      if (seen.has(current)) {
        diagnostics.push(
          grammarDiagnostic(
            "error",
            "qc-definebone-cycle",
            `$definebone ${start} climbs into a parent cycle through ${current}`,
            file,
            bone.line,
          ),
        );
        break;
      }
      seen.add(current);
      current = parentOf.get(current) ?? "";
    }
  }
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
    // `studiomdl` resolves `$modelname` inside the game's `models/` directory: real QCs
    // write `props_junk/box.mdl`, not `models/props_junk/box.mdl`. A leading `models/`
    // therefore produces `models/models/...`, which the engine never loads. The old check
    // had it backwards and warned about the correct form.
    if (name.toLowerCase().startsWith("models/") || name.toLowerCase().startsWith("models\\")) {
      diagnostics.push({
        severity: "warning",
        rule: "qc-modelname-includes-models",
        message:
          `$modelname "${name}" starts with models/; studiomdl already resolves it under ` +
          "the game's models/ directory, so this writes models/models/... and the engine " +
          "will not find it",
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

  if (
    byCommand("$body").length === 0 &&
    byCommand("$bodygroup").length === 0 &&
    byCommand("$model").length === 0
  ) {
    diagnostics.push({
      severity: "error",
      rule: "qc-no-body",
      message: "no $body, $model or $bodygroup; the model has no geometry",
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
  const tokens = lexQc(stripBom(readFileSync(path, "utf8")));
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
 * Collects every bone name declared anywhere in the include tree.
 *
 * `$definebone` lines for a viewmodel live in one shared `bones.qci`, and the 49 QCs that
 * include it declare only the bones they add. Checking each file on its own therefore
 * warns about a parent that is declared perfectly well one include away. This pre-pass has
 * to follow `$cd`/`$pushd`/`$popd` because the include loader does.
 */
function seedDeclaredBones(
  path: string,
  bones: Set<string>,
  chain: string[],
  depth: number,
  startDir: string,
): string {
  if (depth > 16 || chain.includes(path) || !existsSync(path)) return startDir;
  const tokens = lexQc(stripBom(readFileSync(path, "utf8")));
  let qdir = startDir;
  const stack: string[] = [];
  let index = 0;
  while (index < tokens.length) {
    const line = tokens[index]!.line;
    const texts: string[] = [];
    while (index < tokens.length && tokens[index]!.line === line) {
      texts.push(tokens[index]!.text);
      index += 1;
    }
    const command = texts[0]!.toLowerCase();
    if (command === "$definebone") {
      if (texts[1]) bones.add(texts[1].toLowerCase());
    } else if (command === "$pushd") {
      stack.push(qdir);
      if (texts[1]) qdir = resolve(qdir, texts[1].replace(/\\/g, "/"));
    } else if (command === "$popd") {
      qdir = stack.pop() ?? qdir;
    } else if (command === "$cd") {
      if (texts[1]) qdir = resolve(qdir, texts[1].replace(/\\/g, "/"));
    } else if (command === "$include") {
      for (const arg of texts.slice(1)) {
        qdir = seedDeclaredBones(
          resolve(qdir, arg.replace(/\\/g, "/")),
          bones,
          [...chain, path],
          depth + 1,
          qdir,
        );
      }
    }
  }
  return qdir;
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
  const declaredBones = new Set<string>();
  seedDeclaredBones(absolute, declaredBones, [], 0, dirname(absolute));
  const root = parseQc(readFileSync(absolute, "utf8"), absolute, variables, macros, declaredBones);

  const loadIncludes = (file: QcFile, chain: string[], depth: number, startDir: string): string => {
    // scriplib keeps one global `qdir`; `$pushd`, `$popd` and `$cd` change it while the
    // script is read, so an `$include` is resolved against the directory in force at that
    // point, not against the including file's own directory.
    let qdir = startDir;
    const stack: string[] = [];
    for (const statement of file.statements) {
      const command = statement.command.toLowerCase();
      if (command === "$pushd") {
        stack.push(qdir);
        const target = statement.args[0];
        if (target) qdir = resolve(qdir, target.replace(/\\/g, "/"));
        continue;
      }
      if (command === "$popd") {
        qdir = stack.pop() ?? qdir;
        continue;
      }
      if (command === "$cd") {
        const target = statement.args[0];
        if (target) qdir = resolve(qdir, target.replace(/\\/g, "/"));
        continue;
      }
      if (command !== "$include") continue;
      for (const arg of statement.args) {
        const target = resolve(qdir, arg.replace(/\\/g, "/"));
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
        const child = parseQc(
          readFileSync(target, "utf8"),
          target,
          variables,
          macros,
          declaredBones,
        );
        file.includes.push(target);
        file.included.push(child);
        qdir = loadIncludes(child, [...chain, target], depth + 1, qdir);
      }
    }
    return qdir;
  };

  loadIncludes(root, [absolute], 0, dirname(absolute));
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
  /** `$poseparameter`: a named slider studiomdl exposes to sequences and blends. */
  poseParameters?: Array<{ name: string; min: number; max: number; loop?: number }>;
  /** `$bodygroup`: named alternatives, each a studio SMD or a blank index. */
  bodygroups?: Array<{
    name: string;
    options: Array<{ studio?: string; blank?: number }>;
  }>;
  /** `$lod`: a distance and the high/low replacement. */
  lods?: Array<{ distance: number; source: string; replace: string; shadow?: boolean }>;
  /** `$hboxset` plus its `$hbox` boxes. */
  hitboxSets?: Array<{
    name: string;
    boxes: Array<{ group: number; bone: string; mins: [number, number, number]; maxs: [number, number, number] }>;
  }>;
  bbox?: { mins: [number, number, number]; maxs: [number, number, number] };
  cbox?: { mins: [number, number, number]; maxs: [number, number, number] };
  illumposition?: [number, number, number];
  eyeposition?: [number, number, number];
  /**
   * `$collisionmodel`: the physics SMD, and the block studiomdl reads it with. A model
   * without one has no `.phy`; a `prop_static` from it is not solid.
   */
  collision?: {
    smd: string;
    mass?: number;
    concave?: boolean;
    /** Raw lines inside the block, e.g. `$maxconvexpieces 12`. */
    extra?: string[];
  };
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
  if (spec.collision) {
    if (!spec.collision.smd) throw new Error("a $collisionmodel needs an SMD path");
    if (
      spec.collision.mass !== undefined &&
      (!Number.isFinite(spec.collision.mass) || spec.collision.mass <= 0)
    ) {
      throw new Error("$collisionmodel mass must be a positive finite number");
    }
  }

  // `studiomdl` prepends the game's `models/` directory to `$modelname`. Accepting the
  // full engine path here and stripping the prefix keeps the common "paste the model path"
  // input from compiling to `models/models/...`.
  const modelname = spec.modelname.replace(/^[\\/]*models[\\/]+/i, "").replace(/^[\\/]+/, "");
  if (!modelname) throw new Error("a QC needs a $modelname inside models/");

  const lines: string[] = [`$modelname ${quote(modelname)}`];
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

  for (const pose of spec.poseParameters ?? []) {
    if (!pose.name || /["\r\n]/.test(pose.name)) {
      throw new Error(`a $poseparameter name cannot be empty or contain a quote/newline`);
    }
    for (const value of [pose.min, pose.max, pose.loop ?? 0]) {
      if (!Number.isFinite(value)) {
        throw new Error(`$poseparameter ${pose.name} needs finite min/max/loop values`);
      }
    }
    lines.push(
      `$poseparameter ${quote(pose.name)} ${pose.min} ${pose.max} ${pose.loop ?? 0}`,
    );
  }

  for (const group of spec.bodygroups ?? []) {
    lines.push(`$bodygroup ${quote(group.name)}`);
    lines.push("{");
    for (const option of group.options) {
      if (option.studio !== undefined && option.blank !== undefined) {
        throw new Error(`$bodygroup ${group.name}: an option is studio or blank, not both`);
      }
      if (option.studio === undefined && option.blank === undefined) {
        throw new Error(`$bodygroup ${group.name}: an option needs studio or blank`);
      }
      lines.push(option.studio !== undefined ? `\tstudio ${quote(option.studio)}` : `\tblank ${option.blank}`);
    }
    lines.push("}");
  }

  for (const lod of spec.lods ?? []) {
    if (!Number.isFinite(lod.distance) || lod.distance <= 0) {
      throw new Error(`$lod distance must be positive, got ${lod.distance}`);
    }
    lines.push(`$${lod.shadow ? "shadowlod" : "lod"} ${lod.distance}`);
    lines.push("{");
    lines.push(`\treplacemodel ${quote(lod.source)} ${quote(lod.replace)}`);
    lines.push("}");
  }

  for (const set of spec.hitboxSets ?? []) {
    lines.push(`$hboxset ${quote(set.name)}`);
    for (const box of set.boxes) {
      lines.push(
        `$hbox ${box.group} ${quote(box.bone)} ${[...box.mins, ...box.maxs].join(" ")}`,
      );
    }
  }

  if (spec.bbox) lines.push(`$bbox ${[...spec.bbox.mins, ...spec.bbox.maxs].join(" ")}`);
  if (spec.cbox) lines.push(`$cbox ${[...spec.cbox.mins, ...spec.cbox.maxs].join(" ")}`);
  if (spec.illumposition) lines.push(`$illumposition ${spec.illumposition.join(" ")}`);
  if (spec.eyeposition) lines.push(`$eyeposition ${spec.eyeposition.join(" ")}`);

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

  if (spec.collision) {
    lines.push(`$collisionmodel ${quote(spec.collision.smd)}`);
    lines.push("{");
    if (spec.collision.mass !== undefined) lines.push(`\t$mass ${spec.collision.mass}`);
    if (spec.collision.concave) lines.push("\t$concave");
    for (const line of spec.collision.extra ?? []) lines.push(`\t${line}`);
    lines.push("}");
  }

  lines.push(...(spec.extra ?? []));
  lines.push("");
  return `${lines.join("\n")}\n`;
}
