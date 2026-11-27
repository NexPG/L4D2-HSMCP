/**
 * A static read of a Left 4 Dead 2 VScript (.nut).
 *
 * L4D2 scripts are Squirrel, not Lua: `end`, `elseif`, `nil`, `~=` and `--[[` are mistakes
 * that a Lua-trained writer makes and that the engine reports as a compile error with no
 * line. This reader does the checks that can be done without the engine, and it reads the
 * one structure a custom finale depends on: the `DirectorOptions` table.
 *
 * It is deliberately conservative about what is an error. `printl` at the top is a warning,
 * not a rule; an unknown DirectorOptions key is information, because the catalogue here is
 * not the engine's full set. A wrong "error" on a valid script is worse than a missed one:
 * the engine is still the final authority.
 */

import { OPTION_SPECS } from "./api.js";

export type NutSeverity = "error" | "warning" | "info";

export interface NutDiagnostic {
  severity: NutSeverity;
  rule: string;
  message: string;
  line: number | null;
}

export interface NutStage {
  index: number;
  type: string;
  value: string | null;
}

export interface NutReport {
  path: string;
  ok: boolean;
  functions: string[];
  includes: string[];
  directorOptions: Record<string, string>;
  mutationOptions: Record<string, string>;
  stageCount: number | null;
  stages: NutStage[];
  hasBanner: boolean;
  diagnostics: NutDiagnostic[];
}

function diag(
  severity: NutSeverity,
  rule: string,
  message: string,
  line: number | null = null,
): NutDiagnostic {
  return { severity, rule, message, line };
}

/**
 * Source with comments and string literals blanked, newlines kept.
 *
 * Every structural check runs on this, so `printl("end")` is not mistaken for a Lua block
 * terminator and a URL in a comment does not break brace counting.
 */
export function stripNut(source: string): string {
  const out: string[] = [];
  let index = 0;
  const push = (char: string): void => {
    out.push(char === "\r" ? "" : char);
  };
  while (index < source.length) {
    const char = source[index]!;
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] === "\n") push("\n");
        index += 1;
      }
      index += 2;
      continue;
    }
    if (char === '"' || char === "'" || (char === "@" && (next === '"' || next === "'"))) {
      if (char === "@") {
        push(" ");
        index += 1;
      }
      const quote = source[index]!;
      push(" ");
      index += 1;
      while (index < source.length) {
        const current = source[index]!;
        if (current === "\\") {
          index += 2;
          continue;
        }
        if (current === quote) {
          index += 1;
          break;
        }
        if (current === "\n") push("\n");
        index += 1;
      }
      push(" ");
      continue;
    }
    push(char);
    index += 1;
  }
  return out.join("");
}

function lineOf(code: string, at: number): number {
  let line = 1;
  for (let index = 0; index < at && index < code.length; index += 1) {
    if (code[index] === "\n") line += 1;
  }
  return line;
}

function balance(code: string): NutDiagnostic[] {
  const diagnostics: NutDiagnostic[] = [];
  const stack: Array<{ char: string; line: number }> = [];
  const closing: Record<string, string> = { "}": "{", ")": "(", "]": "[" };
  for (let index = 0; index < code.length; index += 1) {
    const char = code[index]!;
    if (char === "{" || char === "(" || char === "[") {
      stack.push({ char, line: lineOf(code, index) });
    } else if (char in closing) {
      const open = stack.pop();
      if (!open || open.char !== closing[char]) {
        diagnostics.push(
          diag(
            "error",
            "nut-unbalanced",
            `closing ${char} has no matching ${closing[char]}${open ? ` (the open one is at line ${open.line})` : ""}`,
            lineOf(code, index),
          ),
        );
        return diagnostics;
      }
    }
  }
  if (stack.length > 0) {
    const open = stack[stack.length - 1]!;
    diagnostics.push(
      diag("error", "nut-unbalanced", `${open.char} opened here is never closed`, open.line),
    );
  }
  return diagnostics;
}

export function tableBody(code: string, start: number): { body: string; end: number } | null {
  let depth = 0;
  for (let index = start; index < code.length; index += 1) {
    if (code[index] === "{") depth += 1;
    else if (code[index] === "}") {
      depth -= 1;
      if (depth === 0) return { body: code.slice(start + 1, index), end: index };
    }
  }
  return null;
}

/** `key = value` pairs of a Squirrel table literal, one expression per entry. */
function tableEntries(body: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const pattern = /([A-Za-z_]\w*)\s*=\s*([^;\n}]+)/g;
  for (const match of body.matchAll(pattern)) {
    entries[match[1]!] = match[2]!.trim().replace(/,$/, "");
  }
  return entries;
}

function constants(code: string): Set<string> {
  const names = new Set<string>();
  for (const match of code.matchAll(/([A-Za-z_]\w*)\s*(?:<-|=)\s*-?\d+/g)) {
    names.add(match[1]!);
  }
  for (const match of code.matchAll(/\bfunction\s+([A-Za-z_]\w*)\s*\(/g)) {
    names.add(match[1]!);
  }
  return names;
}

export function checkNut(source: string, path = "<script>"): NutReport {
  const code = stripNut(source);
  const diagnostics: NutDiagnostic[] = [];

  diagnostics.push(...balance(code));

  if (/^\s*end\s*$/m.test(code)) {
    diagnostics.push(diag("error", "nut-lua-end", "`end` is Lua; Squirrel closes a block with `}`", 1));
  }
  if (/\belseif\b/.test(code)) {
    diagnostics.push(diag("error", "nut-lua-elseif", "`elseif` is Lua; Squirrel uses `else if`"));
  }
  if (/\bthen\b/.test(code)) {
    diagnostics.push(diag("error", "nut-lua-then", "`then` is Lua; Squirrel needs no keyword"));
  }
  if (/\bnil\b/.test(code)) {
    diagnostics.push(diag("error", "nut-lua-nil", "`nil` is Lua; Squirrel uses `null`"));
  }
  if (/~=/.test(code)) {
    diagnostics.push(diag("error", "nut-lua-ne", "`~=` is Lua; Squirrel writes `!=`"));
  }
  if (/--\[\[/.test(code)) {
    diagnostics.push(diag("error", "nut-lua-comment", "`--[[ ]]` is Lua; Squirrel uses `/* */`"));
  } else if (/^\s*--(?!\[)/m.test(code)) {
    diagnostics.push(
      diag(
        "warning",
        "nut-lua-line-comment",
        "`--` starts a Lua comment; Squirrel uses `//` (a line starting with `--x` is a decrement, but that is rare)",
      ),
    );
  }
  if (/\bprint\s*\(/.test(code) && !/\bprintl\s*\(/.test(code)) {
    diagnostics.push(
      diag(
        "warning",
        "nut-print",
        "`print` is not the logging call L4D2 scripts use; `printl` writes to console.log under -condebug",
      ),
    );
  }

  const functions = [...new Set([...code.matchAll(/\bfunction\s+([A-Za-z_]\w*)\s*\(/g)].map((m) => m[1]!))];
  const eventHooks = functions.filter((name) => name.startsWith("OnGameEvent_"));
  if (eventHooks.length > 0) {
    // A hook is registered by whatever loads the file. The four addon-script names are
    // global and run without an entity; everything else needs a logic_script, a mode
    // script, or an include from one of those. `script_execute` alone only runs top-level
    // code and registers nothing.
    const globalAddon =
      /(^|[\\/])(mapspawn|response_testbed|scriptedmode|director_base)_addon\.nut$/i.test(path);
    diagnostics.push(
      diag(
        "info",
        "nut-event-hook-needs-entity",
        globalAddon
          ? `${eventHooks.join(", ")} is in a global addon script; the engine loads it once per chapter or round and registers the hooks`
          : `${eventHooks.join(", ")} fires only when a loader runs this file: a logic_script entity, a mode script, or a mapspawn/mode addon script. script_execute runs the code but registers no hooks`,
      ),
    );
  }
  const includes = [
    ...new Set(
      [...source.matchAll(/\bIncludeScript\s*\(\s*"([^"]+)"/g)].map((match) => match[1]!),
    ),
  ];
  for (const include of includes) {
    if (include.toLowerCase().endsWith(".nut")) {
      diagnostics.push(
        diag(
          "warning",
          "nut-include-extension",
          `IncludeScript("${include}") includes the .nut extension; the engine adds it, so write the name without it`,
        ),
      );
    }
    if (include.replace(/\\/g, "/").toLowerCase().startsWith("scripts/vscripts/")) {
      diagnostics.push(
        diag(
          "warning",
          "nut-include-root",
          `IncludeScript("${include}") is relative to scripts/vscripts; the prefix is not part of the name`,
        ),
      );
    }
  }

  const hasBanner = /\b(printl|Msg|IncludeScript)\s*\(/.test(code);
  if (!hasBanner) {
    diagnostics.push(
      diag(
        "warning",
        "nut-no-banner",
        "no printl/Msg/IncludeScript: a script that fails to load leaves no evidence in console.log",
      ),
    );
  }

  const assignment = /DirectorOptions\s*(?:<-|=)\s*\{/.exec(code);
  let directorOptions: Record<string, string> = {};
  let stageCount: number | null = null;
  const stages: NutStage[] = [];
  if (assignment) {
    const start = assignment.index + assignment[0].length - 1;
    const table = tableBody(code, start);
    if (table) {
      directorOptions = tableEntries(table.body);
      const countRaw = directorOptions["A_CustomFinale_StageCount"];
      if (countRaw !== undefined) {
        const parsed = Number(countRaw);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          diagnostics.push(
            diag(
              "error",
              "director-stage-count",
              `A_CustomFinale_StageCount is ${countRaw}; it must be a positive integer`,
            ),
          );
        } else {
          stageCount = parsed;
          const defined = constants(code);
          for (let index = 1; index <= parsed; index += 1) {
            const typeKey = `A_CustomFinale${index}`;
            const type = directorOptions[typeKey];
            if (type === undefined) {
              diagnostics.push(
                diag(
                  "error",
                  "director-stage-missing",
                  `A_CustomFinale_StageCount is ${parsed}, but ${typeKey} is missing`,
                ),
              );
              stages.push({ index, type: "", value: directorOptions[`A_CustomFinaleValue${index}`] ?? null });
              continue;
            }
            const value = directorOptions[`A_CustomFinaleValue${index}`] ?? null;
            stages.push({ index, type, value });
            if (!/^-?\d+$/.test(type) && !defined.has(type)) {
              diagnostics.push(
                diag(
                  "warning",
                  "director-stage-undefined",
                  `${typeKey} uses ${type}, which this file never defines`,
                ),
              );
            }
          }
          for (const key of Object.keys(directorOptions)) {
            const match = /^A_CustomFinale(\d+)$/.exec(key);
            if (match && Number(match[1]) > parsed) {
              diagnostics.push(
                diag(
                  "warning",
                  "director-stage-extra",
                  `${key} is beyond A_CustomFinale_StageCount (${parsed})`,
                ),
              );
            }
          }
          if (!functions.includes("OnBeginCustomFinaleStage")) {
            diagnostics.push(
              diag(
                "info",
                "director-stage-hook",
                "no OnBeginCustomFinaleStage function: the stage list still runs, but no script logic runs with it",
              ),
            );
          }
        }
      }
      for (const key of Object.keys(directorOptions)) {
        if (!OPTION_SPECS.has(key) && !/^A_CustomFinale(Value)?\d+$/.test(key)) {
          diagnostics.push(
            diag(
              "info",
              "director-unknown-key",
              `${key} is not in this checker's DirectorOptions catalogue; the engine may still accept it`,
            ),
          );
        }
      }
    }
  }

  let mutationOptions: Record<string, string> = {};
  const mutationAssignment = /MutationOptions\s*(?:<-|=)\s*\{/.exec(code);
  if (mutationAssignment) {
    const start = mutationAssignment.index + mutationAssignment[0].length - 1;
    const table = tableBody(code, start);
    if (table) mutationOptions = tableEntries(table.body);
  }

  const knownMutationKeys = OPTION_SPECS;
  for (const key of Object.keys(mutationOptions)) {
    if (!knownMutationKeys.has(key) && !/^A_CustomFinale(Value)?\d+$/.test(key)) {
      diagnostics.push(
        diag(
          "info",
          "mutation-unknown-key",
          `${key} is not in this checker's MutationOptions catalogue; the engine may still accept it`,
        ),
      );
    }
  }

  return {
    path,
    ok: !diagnostics.some((entry) => entry.severity === "error"),
    functions,
    includes,
    directorOptions,
    mutationOptions,
    stageCount,
    stages,
    hasBanner,
    diagnostics,
  };
}
