import { describe, expect, it } from "vitest";
import { encodeLegacyRequest, parseLegacyResponse } from "../../src/packages/typescript/workshop/legacy.js";

function lines(text: string): Array<[string, string]> {
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const tab = line.indexOf("\t");
      return [line.slice(0, tab), Buffer.from(line.slice(tab + 1), "base64").toString("utf8")];
    });
}

describe("legacy helper protocol", () => {
  it("encodes one tab-separated line per value and skips undefined", () => {
    const text = encodeLegacyRequest({
      command: "update",
      itemId: "1234567890",
      vpk: undefined,
      title: "Title with \u00e9 and \"quotes\"",
      tag: ["Scripts", "Weapons"],
      clearTags: true,
    });
    expect(lines(text)).toEqual([
      ["command", "update"],
      ["itemId", "1234567890"],
      ["title", 'Title with \u00e9 and "quotes"'],
      ["tag", "Scripts"],
      ["tag", "Weapons"],
      ["clearTags", "true"],
    ]);
  });

  it("keeps an empty string distinct from an absent field", () => {
    const text = encodeLegacyRequest({ command: "update", description: "" });
    expect(lines(text)).toEqual([
      ["command", "update"],
      ["description", ""],
    ]);
  });

  it("preserves a multi-line description through base64", () => {
    const description = "line one\nline two\r\nline three";
    const text = encodeLegacyRequest({ description });
    expect(lines(text)).toEqual([["description", description]]);
  });

  it("parses the helper's response and ignores malformed lines", () => {
    const response = [
      `ok\t${Buffer.from("true").toString("base64")}`,
      `itemId\t${Buffer.from("1234567890").toString("base64")}`,
      `error\t${Buffer.from("Steam refused").toString("base64")}`,
      "not-a-pair",
      "",
    ].join("\r\n");
    expect(parseLegacyResponse(response)).toEqual({
      ok: "true",
      itemId: "1234567890",
      error: "Steam refused",
    });
  });
});
