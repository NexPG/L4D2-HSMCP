/**
 * Windows argv, not shell words.
 *
 * The editor stores compiler parameters as one string. A splitter that treats every space
 * as a separator turns `C:\Program Files\...` into two arguments; one that honours quotes
 * but not backslash runs corrupts every map path, because `$path\$file` is full of them.
 * These cases are the rules `CommandLineToArgvW` implements.
 */
import { describe, expect, it } from "vitest";
import { splitWindowsArgs } from "../../src/maps/typescript/compile/commandline.js";
import { substituteSequenceArgs } from "../../src/maps/typescript/compile/sequences.js";

describe("splitWindowsArgs", () => {
  it("keeps a quoted path with spaces as one argument", () => {
    expect(splitWindowsArgs('-game "D:\\Left 4 Dead 2\\left4dead2" "D:\\Maps\\a b.vmf"')).toEqual([
      "-game",
      "D:\\Left 4 Dead 2\\left4dead2",
      "D:\\Maps\\a b.vmf",
    ]);
  });

  it("leaves ordinary backslashes alone", () => {
    expect(splitWindowsArgs("-game D:\\Game\\left4dead2 D:\\Maps\\c1m1")).toEqual([
      "-game",
      "D:\\Game\\left4dead2",
      "D:\\Maps\\c1m1",
    ]);
  });

  it("turns a backslash before a quote into a literal quote when the count is odd", () => {
    expect(splitWindowsArgs('a\\"b')).toEqual(['a"b']);
  });

  it("turns two backslashes before a quote into one and lets the quote delimit", () => {
    expect(splitWindowsArgs('a\\\\"b c"')).toEqual(["a\\b c"]);
  });

  it("keeps an explicitly empty argument", () => {
    expect(splitWindowsArgs('vbsp "" next')).toEqual(["vbsp", "", "next"]);
  });

  it("keeps a trailing backslash and collapses runs of whitespace", () => {
    expect(splitWindowsArgs("  one   two\\  ")).toEqual(["one", "two\\"]);
  });
});

describe("substituteSequenceArgs", () => {
  it("splits first, so a variable containing spaces stays one argument", () => {
    const r = substituteSequenceArgs("-game $gamedir $path\\$file", {
      gamedir: "D:\\Left 4 Dead 2\\left4dead2",
      path: "D:\\Maps",
      file: "c1m1",
    });
    expect(r.args).toEqual(["-game", "D:\\Left 4 Dead 2\\left4dead2", "D:\\Maps\\c1m1"]);
    expect(r.unknown).toEqual([]);
  });

  it("reports the unknown names once, not once per token", () => {
    const r = substituteSequenceArgs("$nope $nope $gamedir", { gamedir: "D:\\g" });
    expect(r.args).toEqual(["$nope", "$nope", "D:\\g"]);
    expect(r.unknown).toEqual(["$nope"]);
  });
});
