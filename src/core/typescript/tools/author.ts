/**
 * Who wrote the addon or campaign.
 *
 * This is not the toolkit's author and has no default: a default would put one person's name
 * on everyone else's content. The agent asks once, stores the answer with `set_addon_author`,
 * and every writer uses it unless the caller passes an explicit `author`. Changing the name
 * is the same tool call again.
 */
import { z } from "zod";
import { configFilePath, writeConfigValue } from "../config.js";
import type { Config } from "../config.js";
import { defineTool } from "../mcp/registry.js";

/**
 * The author a writer must use: the explicit name, the configured name, or a refusal.
 *
 * `requested` wins so a caller can deliberately sign one addon differently; otherwise the
 * stored name is used. Neither being set is a configuration error, not an empty string,
 * because `addonauthor ""` is a file the menu shows as having no author.
 */
export function addonAuthor(config: Pick<Config, "addonAuthor">, requested?: string): string {
  const name = (requested ?? config.addonAuthor ?? "").trim();
  if (!name) {
    throw new Error(
      "no addon author is configured. Ask the user for the name they want in " +
        "`addonauthor`/`Author`, then call `set_addon_author`. Do not copy a name from an " +
        "example.",
    );
  }
  return name;
}

export const readAddonAuthorTool = defineTool({
  name: "read_addon_author",
  description:
    "Reports the author name used for `addonauthor` in addoninfo.txt and `Author` in a " +
    "campaign mission. Null means it has not been configured: ask the user once, then call " +
    "`set_addon_author`. Read-only.",
  realm: "local",
  inputSchema: {},
  outputSchema: {
    author: z.string().nullable(),
    configPath: z.string(),
  },
  handler: (_args, ctx) => ({
    author: ctx.config.addonAuthor?.trim() || null,
    configPath: configFilePath(ctx.config.repoRoot),
  }),
});

export const setAddonAuthorTool = defineTool({
  name: "set_addon_author",
  description:
    "Stores the author name written into every generated addon and campaign. This is the " +
    "person making the content, not the toolkit author; there is no default. Ask the user " +
    "once before generating, store the answer here, and reuse it. Calling it again changes " +
    "the name for later generations; it does not rewrite files already written. Writes the " +
    "local `<repoRoot>/.hammer-mcp/config.json` and preserves every other field.",
  realm: "local",
  inputSchema: {
    author: z.string().min(1).describe("The name to write, e.g. a person's or team's name."),
  },
  outputSchema: {
    author: z.string(),
    previous: z.string().nullable(),
    path: z.string(),
  },
  handler: (args, ctx) => {
    const author = args.author.trim();
    if (!author) throw new Error("author is empty; give the name to store");
    const { path, previous } = writeConfigValue(ctx.config.repoRoot, "addonAuthor", author);
    // The running server loaded the config at start; without this, the next tool in the same
    // session would still refuse until a restart.
    ctx.config.addonAuthor = author;
    ctx.audit.record({ kind: "config_write", data: { path, key: "addonAuthor" } });
    return {
      author,
      previous: typeof previous === "string" ? previous : null,
      path,
    };
  },
});

export const authorTools = [readAddonAuthorTool, setAddonAuthorTool];
