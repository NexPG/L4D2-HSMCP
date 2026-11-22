/**
 * The author name is a person, not a toolkit constant. It has no default: an unset value
 * refuses generation rather than writing an empty or borrowed name. These tests use a
 * temporary repo root for the config file so the real `.hammer-mcp/config.json` is untouched.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import {
  addonAuthor,
  readAddonAuthorTool,
  setAddonAuthorTool,
} from "../../src/core/typescript/tools/author.js";
import { writeAddonInfoTool } from "../../src/packages/typescript/tools/addon.js";
import { writeCampaignTool } from "../../src/campaigns/typescript/tools/campaign.js";
import { ctx as sharedCtx } from "../support/env.js";

const scratch = mkdtempSync(join(tmpdir(), "hammer-author-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const ctxWith = (author?: string): ToolContext =>
  ({
    config: {
      ...sharedCtx.config,
      repoRoot: scratch,
      stateDir: join(scratch, ".hammer-mcp"),
      ...(author === undefined ? { addonAuthor: undefined } : { addonAuthor: author }),
    },
    audit: { record: () => undefined },
  }) as unknown as ToolContext;

describe("addonAuthor", () => {
  it("prefers the explicit name, then the configured one", () => {
    expect(addonAuthor({ addonAuthor: "Configured" }, "Explicit")).toBe("Explicit");
    expect(addonAuthor({ addonAuthor: "Configured" })).toBe("Configured");
  });

  it("refuses when neither is set instead of writing an empty author", () => {
    expect(() => addonAuthor({ addonAuthor: undefined })).toThrow(/no addon author is configured/);
    expect(() => addonAuthor({ addonAuthor: "   " })).toThrow(/no addon author is configured/);
  });
});

describe("the author setting", () => {
  it("stores the name in the local config and preserves the previous one", () => {
    const ctx = ctxWith();
    const first = setAddonAuthorTool.handler({ author: "Alice" }, ctx) as {
      author: string;
      previous: string | null;
    };
    expect(first.author).toBe("Alice");
    expect(first.previous).toBeNull();
    const path = join(scratch, ".hammer-mcp", "config.json");
    expect(JSON.parse(readFileSync(path, "utf8")).addonAuthor).toBe("Alice");

    const second = setAddonAuthorTool.handler({ author: "Bob" }, ctx) as {
      author: string;
      previous: string | null;
    };
    expect(second.previous).toBe("Alice");
    expect(JSON.parse(readFileSync(path, "utf8")).addonAuthor).toBe("Bob");
    expect(ctx.config.addonAuthor).toBe("Bob");
  });

  it("reports the configured value, or null", () => {
    expect((readAddonAuthorTool.handler({}, ctxWith("Alice")) as { author: string }).author).toBe(
      "Alice",
    );
    expect((readAddonAuthorTool.handler({}, ctxWith()) as { author: string | null }).author).toBe(
      null,
    );
  });

  it("is used by write_addoninfo when the caller omits the author", async () => {
    const path = join(scratch, "addoninfo.txt");
    await writeAddonInfoTool.handler({ path, title: "Fallback", confirm: true } as never, ctxWith("Tester"));
    expect(readFileSync(path, "utf8")).toContain('"addonauthor"\t"Tester"');
  });

  it("is used by write_campaign when the caller omits the author", async () => {
    const out = join(scratch, "mission.txt");
    await writeCampaignTool.handler(
      {
        out,
        name: "TEST",
        modes: [{ name: "coop", chapters: [{ map: "testm1", displayName: "One" }] }],
        confirm: true,
      } as never,
      ctxWith("Tester"),
    );
    expect(readFileSync(out, "utf8")).toContain('"Author"\t\t"Tester"');
  });

  it("refuses generation when no name has been configured", async () => {
    await expect(
      async () =>
        writeAddonInfoTool.handler(
          { path: join(scratch, "none.txt"), title: "No Author", confirm: true } as never,
          ctxWith(),
        ),
    ).rejects.toThrow(/no addon author is configured/);
    await expect(
      async () =>
        writeCampaignTool.handler(
          {
            out: join(scratch, "none-mission.txt"),
            name: "NONE",
            modes: [{ name: "coop", chapters: [{ map: "testm1", displayName: "One" }] }],
            confirm: true,
          } as never,
          ctxWith(),
        ),
    ).rejects.toThrow(/no addon author is configured/);
  });
});
