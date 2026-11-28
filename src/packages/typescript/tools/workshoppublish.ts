/**
 * Steam Workshop tools for L4D2: account status, listing, reading, publishing, updating
 * and deleting an item.
 *
 * The tools bind two Steam paths, because L4D2 needs both:
 *
 * - **Content** goes through `ISteamRemoteStorage::PublishWorkshopFile` and its legacy
 *   update request. `SetItemContent` and SteamCMD's `workshop_build_item` both answer
 *   `Invalid Parameter` for an L4D2 item, so the modern content path cannot be used.
 * - **Metadata, additional previews, videos and dependencies** go through
 *   `@hagicode/steamworks.js` (ISteamUGC), with the consumer app id **550**. The client
 *   initialises as 563 (Authoring Tools), and every UGC update made with 563 or the
 *   default app id fails with `a parameter is invalid`.
 *
 * Neither path asks for a password: the running Steam client is the credential.
 */
import { existsSync, statSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { CONFIRM, resolveInput } from "../../../core/typescript/tools/paths.js";
import type { Config } from "../../../core/typescript/config.js";
import {
  changeDependencies,
  deleteWorkshopItem,
  errorMessage,
  L4D2_CONSUMER_APP_ID,
  L4D2_CREATOR_APP_ID,
  listWorkshopItems,
  readWorkshopItem,
  requireOwnedItem,
  steamAccount,
  updateWorkshopItemModern,
  visibilityNumber,
} from "../workshop/client.js";
import {
  legacyEnvironment,
  legacyHelperStatus,
  legacyPublish,
  legacyUpdate,
} from "../workshop/legacy.js";
import type { WorkshopItemView } from "../workshop/types.js";

const ITEM_ID = z
  .string()
  .regex(/^\d+$/, "a published file id is digits only")
  .describe("Workshop published file id, as a decimal string.");

const VISIBILITY = z
  .enum(["public", "friends", "private", "unlisted"])
  .describe("0 public, 1 friends, 2 private, 3 unlisted.");

const TAGS = z
  .array(z.string().min(1))
  .default([])
  .describe(
    "Workshop tags, such as Campaigns, Maps, Scripts, Weapons or Survival. The string " +
      "must be one of the tags the L4D2 Workshop page offers; Steam stores an unknown tag " +
      "but the Workshop filter will not show it.",
  );

const PREVIEW = z.object({
  urlOrVideoId: z.string(),
  originalFilename: z.string(),
  kind: z.enum([
    "image",
    "youtube",
    "sketchfab",
    "environmentMapHorizontalCross",
    "environmentMapLatLong",
    "clip",
    "unknown",
  ]),
});

const STATISTICS = z.object({
  subscriptions: z.number(),
  favorites: z.number(),
  followers: z.number(),
  uniqueSubscriptions: z.number(),
  uniqueFavorites: z.number(),
  uniqueFollowers: z.number(),
  websiteViews: z.number(),
  comments: z.number(),
});

const ITEM = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  visibility: z.enum(["public", "friends", "private", "unlisted"]),
  tags: z.array(z.string()),
  tagsTruncated: z.boolean(),
  previewUrl: z.string().nullable(),
  additionalPreviews: z.array(PREVIEW),
  children: z.array(z.string()).describe("Required items, as published file ids."),
  numChildren: z.number(),
  url: z.string(),
  ownerSteamId: z.string(),
  creatorAppId: z.number().nullable(),
  consumerAppId: z.number().nullable(),
  timeCreated: z.number(),
  timeUpdated: z.number(),
  banned: z.boolean(),
  acceptedForUse: z.boolean(),
  supportedGameVersions: z.array(
    z.object({ minBranch: z.string().nullable(), maxBranch: z.string().nullable() }),
  ),
  statistics: STATISTICS,
});

const DEPENDENCIES = z.object({
  before: z.array(z.string()),
  after: z.array(z.string()),
  added: z.array(z.string()),
  removed: z.array(z.string()),
  failed: z.array(z.object({ id: z.string(), code: z.union([z.number(), z.string()]) })),
});

const HELPER = z.object({
  source: z.string().nullable(),
  csc: z.string().nullable().describe("Windows .NET Framework csc.exe used to compile the helper."),
  dll: z.string().nullable().describe("steam_api64.dll bundled with @hagicode/steamworks.js."),
  cacheDir: z.string(),
  exe: z.string(),
  built: z.boolean(),
  stale: z.boolean(),
});

function cleanTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))];
}

function imageFile(value: string, config: Config, label: string, gif: boolean): string {
  const full = resolveInput(value, config);
  if (!existsSync(full) || !statSync(full).isFile()) throw new Error(`${label} not found: ${full}`);
  const pattern = gif ? /\.(jpe?g|png|gif)$/i : /\.(jpe?g|png)$/i;
  if (!pattern.test(full)) {
    throw new Error(`${label} must be ${gif ? ".jpg, .png or .gif" : ".jpg or .png"}: ${full}`);
  }
  return full;
}

function vpkFile(value: string, config: Config): { path: string; bytes: number } {
  const full = resolveInput(value, config);
  if (!existsSync(full) || !statSync(full).isFile()) throw new Error(`VPK not found: ${full}`);
  if (!/\.vpk$/i.test(full)) throw new Error(`not a VPK: ${full}`);
  const bytes = statSync(full).size;
  if (bytes === 0) throw new Error(`VPK is empty: ${full}`);
  return { path: full, bytes };
}

function videoId(value: string): string {
  if (!/^[A-Za-z0-9_-]{11}$/.test(value)) {
    throw new Error(`"${value}" is not an 11-character YouTube video id`);
  }
  return value;
}

function dependencyIds(values: readonly string[]): string[] {
  for (const value of values) {
    if (!/^\d+$/.test(value)) throw new Error(`dependency ${value} is not a published file id`);
  }
  return [...new Set(values)];
}

// ---------------------------------------------------------------------------------------

export const readWorkshopAccountTool = defineTool({
  name: "read_workshop_account",
  description:
    "Reports the Steam account and L4D2 Workshop state on this machine: the running " +
    "Steam client's persona, SteamID64 and accountId, the L4D2 app ids, how many items " +
    "the account has published, and the Steam Cloud quota the legacy uploader stages " +
    "content through. It also reports the on-demand upload helper's paths and whether the " +
    "Windows csc.exe and bundled steam_api64.dll are present. No password is read, stored " +
    "or requested: the Steam client must be running and signed in. Read-only; use it before " +
    "the first publish or when a Workshop tool cannot reach Steam.",
  realm: "local",
  inputSchema: {},
  outputSchema: {
    account: z
      .object({
        steamId64: z.string(),
        steamId32: z.string(),
        accountId: z.number(),
        personaName: z.string(),
      })
      .nullable(),
    steamError: z.string().nullable(),
    apps: z.object({ creator: z.number(), consumer: z.number() }),
    publishedItems: z.number().nullable(),
    listError: z.string().nullable(),
    cloud: z
      .object({
        helperVersion: z.string(),
        quotaRead: z.boolean(),
        quotaTotal: z.number(),
        quotaAvailable: z.number(),
      })
      .nullable(),
    cloudError: z.string().nullable(),
    helper: HELPER,
    credentials: z.string(),
  },
  handler: async (_args, ctx) => {
    let account: {
      steamId64: string;
      steamId32: string;
      accountId: number;
      personaName: string;
    } | null = null;
    let steamError: string | null = null;
    try {
      account = steamAccount();
    } catch (error) {
      steamError = errorMessage(error);
    }

    let publishedItems: number | null = null;
    let listError: string | null = null;
    if (account !== null) {
      try {
        const page = await listWorkshopItems({ limit: 1, kind: "published" });
        publishedItems = page.steamTotal;
      } catch (error) {
        listError = errorMessage(error);
      }
    }

    let cloud: {
      helperVersion: string;
      quotaRead: boolean;
      quotaTotal: number;
      quotaAvailable: number;
    } | null = null;
    let cloudError: string | null = null;
    if (steamError === null) {
      try {
        cloud = await legacyEnvironment(ctx.config);
      } catch (error) {
        cloudError = errorMessage(error);
      }
    }

    return {
      account,
      steamError,
      apps: { creator: L4D2_CREATOR_APP_ID, consumer: L4D2_CONSUMER_APP_ID },
      publishedItems,
      listError,
      cloud,
      cloudError,
      helper: legacyHelperStatus(ctx.config),
      credentials:
        "none stored: every call uses the already signed-in Steam client and never asks " +
        "for a password",
    };
  },
});

export const readWorkshopItemsTool = defineTool({
  name: "read_workshop_items",
  description:
    "Lists the signed-in Steam account's L4D2 Workshop items: published by default, or " +
    "subscribed, favorites or played. Each row carries the id, title, visibility, tags, " +
    "main preview URL, update time, required-item count, statistics and Web URL; pass the " +
    "id to read_workshop_item. Steam's first page is 1 (page 0 cannot create the query); " +
    "`all` pages through the list, and `search` filters title and description locally " +
    "because Steam's user-list query ignores the search text. `limit` caps the result. " +
    "Read-only.",
  realm: "local",
  inputSchema: {
    kind: z
      .enum(["published", "subscribed", "favorites", "played"])
      .default("published")
      .describe("Which of the account's lists to read."),
    page: z.number().int().min(1).default(1).describe("Steam page, 1-based."),
    all: z.boolean().default(false).describe("Page through every result up to limit."),
    limit: z.number().int().min(1).max(200).default(50),
    search: z
      .string()
      .optional()
      .describe("Case-insensitive filter on title and description; implies all pages."),
    sort: z
      .enum(["lastUpdated", "created", "title"])
      .default("lastUpdated")
      .describe("Steam's order for the list."),
    includeDescriptions: z
      .boolean()
      .default(false)
      .describe("Include each item's full description in the row."),
  },
  outputSchema: {
    kind: z.enum(["published", "subscribed", "favorites", "played"]),
    page: z.number(),
    pages: z.number(),
    total: z.number().describe("Rows after the local search, before the limit."),
    steamTotal: z.number().describe("Steam's total for the list, ignoring the local search."),
    truncated: z.boolean(),
    items: z.array(ITEM),
  },
  handler: async (args, _ctx) => {
    const result = await listWorkshopItems({
      kind: args.kind,
      page: args.page,
      all: args.all,
      limit: args.limit,
      search: args.search,
      sort: args.sort,
    });
    const items: WorkshopItemView[] = args.includeDescriptions
      ? result.items
      : result.items.map((item) => ({ ...item, description: "" }));
    return {
      kind: args.kind,
      page: args.page,
      pages: result.pages,
      total: result.total,
      steamTotal: result.steamTotal,
      truncated: result.truncated,
      items,
    };
  },
});

export const readWorkshopItemTool = defineTool({
  name: "read_workshop_item",
  description:
    "Reads one L4D2 Workshop item by id: title, description, visibility, tags, main " +
    "preview, additional images and videos, owner, dates, statistics, supported game " +
    "versions and the Web URL. `includeChildren` adds the required-item ids; " +
    "`includeAdditionalPreviews` adds the extra images and YouTube videos. A private item " +
    "is visible only to its owner, so use the same signed-in Steam account. Read-only.",
  realm: "local",
  inputSchema: {
    itemId: ITEM_ID,
    includeChildren: z.boolean().default(true),
    includeAdditionalPreviews: z.boolean().default(true),
    language: z
      .string()
      .optional()
      .describe("Steam language code for title and description, such as english or russian."),
  },
  outputSchema: { item: ITEM },
  handler: async (args, _ctx) => {
    const item = await readWorkshopItem(args.itemId, {
      includeChildren: args.includeChildren,
      includeAdditionalPreviews: args.includeAdditionalPreviews,
      language: args.language,
    });
    return { item };
  },
});

const COMMON_PUBLISH_FIELDS = {
  vpkPath: z
    .string()
    .describe(
      "Built add-on VPK. It must already contain addoninfo.txt; build it with run_vpk_pack. " +
        "The Workshop item's content is this one file, which L4D2 downloads as " +
        "addons/workshop/<id>.vpk.",
    ),
  title: z.string().min(1).describe("Workshop title, separate from addoninfo.txt."),
  description: z
    .string()
    .default("")
    .describe("Workshop description; separate from addonDescription in addoninfo.txt."),
  previewPath: z
    .string()
    .optional()
    .describe("Main preview image (.jpg or .png). Omit only when the item already has one."),
  tags: TAGS,
  visibility: VISIBILITY.default("private"),
  changeNote: z.string().optional().describe("Change note shown in the item's history."),
  dependencies: z
    .array(ITEM_ID)
    .default([])
    .describe("Required Workshop items (foundations), added after the item exists."),
  additionalPreviewPaths: z
    .array(z.string())
    .default([])
    .describe("Extra images shown under the main preview (.jpg, .png or .gif)."),
  additionalPreviewVideos: z
    .array(z.string())
    .default([])
    .describe("YouTube video ids (11 characters) shown as additional previews."),
  language: z
    .string()
    .optional()
    .describe("Steam language code the title and description are written in."),
  contentDescriptors: z
    .array(z.number().int().min(1).max(5))
    .default([])
    .describe(
      "Steam mature-content descriptors: 1 nudity/sexual, 2 frequent violence/gore, " +
        "3 adult-only sexual, 4 gratuitous sexual, 5 any mature content.",
    ),
};

export const publishWorkshopItemTool = defineTool({
  name: "publish_workshop_item",
  description:
    "Publishes a new L4D2 Workshop item from a built VPK. L4D2 predates ISteamUGC " +
    "content transfer: SetItemContent and SteamCMD workshop_build_item both fail with " +
    "Invalid Parameter, so the content goes through the legacy " +
    "ISteamRemoteStorage::PublishWorkshopFile path in the running Steam client; no " +
    "password is used. Content, main preview, title, description, tags and visibility are " +
    "published in one call, then additional preview images and YouTube videos are added " +
    "through ISteamUGC with consumer app 550 (563 fails), and required-item dependencies " +
    "are added by id. Default visibility is private: verify the item, then update it to " +
    "public. A partial post-publish failure returns the created item id and a warning, so " +
    "the item is not lost. Guarded; dryRun validates the inputs without touching Steam " +
    "(confirm:true is still required by the guard).",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    ...COMMON_PUBLISH_FIELDS,
    dryRun: z.boolean().default(false),
    confirm: CONFIRM,
  },
  outputSchema: {
    dryRun: z.boolean(),
    itemId: z.string().nullable(),
    url: z.string().nullable(),
    needsAgreement: z.boolean(),
    dependencies: DEPENDENCIES.nullable(),
    warnings: z.array(z.string()),
    item: ITEM.nullable(),
  },
  handler: async (args, ctx) => {
    const warnings: string[] = [];
    const vpk = vpkFile(args.vpkPath, ctx.config);
    const preview =
      args.previewPath === undefined
        ? undefined
        : imageFile(args.previewPath, ctx.config, "preview", false);
    const additional = args.additionalPreviewPaths.map((path) =>
      imageFile(path, ctx.config, "additional preview", true),
    );
    const videos = args.additionalPreviewVideos.map(videoId);
    const tags = cleanTags(args.tags);
    const dependencies = dependencyIds(args.dependencies);
    if (tags.length !== args.tags.length) warnings.push("duplicate or blank tags were removed");
    if (vpk.bytes > 2_000_000_000) {
      warnings.push(
        `the VPK is ${vpk.bytes} bytes; Steam's Cloud quota is read by ` +
          "read_workshop_account and is usually about 2 GB, so the upload may be refused",
      );
    }

    if (args.dryRun) {
      return {
        dryRun: true,
        itemId: null,
        url: null,
        needsAgreement: false,
        dependencies: null,
        warnings,
        item: null,
      };
    }

    const published = await legacyPublish(ctx.config, {
      vpk: vpk.path,
      ...(preview === undefined ? {} : { preview }),
      title: args.title,
      description: args.description,
      tags,
      visibility: visibilityNumber(args.visibility),
    });
    if (published.needsAgreement) {
      warnings.push(
        "Steam says the account still has to accept the Workshop legal agreement; the " +
          "item exists but may stay hidden until that is accepted in the Steam client",
      );
    }

    const itemId = published.itemId;
    const modern: Parameters<typeof updateWorkshopItemModern>[1] = {};
    if (additional.length > 0) modern.additionalPreviewPaths = additional;
    if (videos.length > 0) modern.additionalPreviewVideos = videos;
    if (args.language !== undefined) modern.language = args.language;
    if (args.contentDescriptors.length > 0) {
      modern.contentDescriptors = { add: args.contentDescriptors };
    }
    if (Object.keys(modern).length > 0) {
      try {
        await updateWorkshopItemModern(itemId, modern);
      } catch (error) {
        warnings.push(
          `the item was created, but the additional media/metadata step failed: ` +
            `${errorMessage(error)}. Fix it with update_workshop_item.`,
        );
      }
    }

    let dependencyChange = null;
    try {
      dependencyChange = await changeDependencies(itemId, dependencies, []);
      for (const failure of dependencyChange.failed) {
        warnings.push(`required item ${failure.id} was not added: ${String(failure.code)}`);
      }
    } catch (error) {
      warnings.push(`required items were not added: ${errorMessage(error)}`);
    }

    const item = await readWorkshopItem(itemId, {
      includeChildren: true,
      includeAdditionalPreviews: true,
    });
    return {
      dryRun: false,
      itemId,
      url: item.url,
      needsAgreement: published.needsAgreement,
      dependencies: dependencyChange,
      warnings,
      item,
    };
  },
});

export const updateWorkshopItemTool = defineTool({
  name: "update_workshop_item",
  description:
    "Updates an existing L4D2 Workshop item owned by the signed-in account. Content " +
    "(vpkPath), main preview, title, description, tags and visibility go through the " +
    "legacy ISteamRemoteStorage update request in the running Steam client, because " +
    "L4D2's ISteamUGC content path returns Invalid Parameter. Additional preview images, " +
    "YouTube videos, content descriptors, key-value tags and language go through " +
    "ISteamUGC with consumer app 550. Required items are added or removed by id. Only the " +
    "fields you pass change; `tags` replaces the whole list, and an empty list clears it. " +
    "Guard `dryRun` reads the item and reports the plan without submitting. Guarded; " +
    "refuses an item the signed-in account does not own.",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    itemId: ITEM_ID,
    vpkPath: z
      .string()
      .optional()
      .describe("New content VPK. Omit to leave the item's content untouched."),
    previewPath: z.string().optional().describe("New main preview image (.jpg or .png)."),
    clearPreview: z.boolean().default(false).describe("Remove the main preview image."),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    tags: z
      .array(z.string().min(1))
      .optional()
      .describe("Replacement tag list; an empty array clears every tag."),
    visibility: VISIBILITY.optional(),
    changeNote: z.string().optional(),
    dependencies: z.array(ITEM_ID).default([]).describe("Required items to add."),
    removeDependencies: z.array(ITEM_ID).default([]).describe("Required items to remove."),
    additionalPreviewPaths: z
      .array(z.string())
      .default([])
      .describe("Images appended to the additional previews."),
    removeAdditionalPreviewIndexes: z
      .array(z.number().int().min(0))
      .default([])
      .describe("0-based indexes in the item's current additionalPreviews to remove."),
    additionalPreviewVideos: z
      .array(z.string())
      .default([])
      .describe("YouTube video ids (11 characters) appended to the additional previews."),
    contentDescriptors: z
      .object({
        add: z.array(z.number().int().min(1).max(5)).default([]),
        remove: z.array(z.number().int().min(1).max(5)).default([]),
      })
      .optional(),
    keyValueTags: z
      .object({
        clear: z.boolean().optional(),
        remove: z.array(z.string()).optional(),
        add: z.array(z.object({ key: z.string().min(1), value: z.string() })).optional(),
      })
      .optional(),
    language: z.string().optional(),
    dryRun: z.boolean().default(false),
    confirm: CONFIRM,
  },
  outputSchema: {
    dryRun: z.boolean(),
    itemId: z.string(),
    before: ITEM.nullable(),
    after: ITEM.nullable(),
    legacyUpdated: z.boolean(),
    modernUpdated: z.boolean(),
    dependencies: DEPENDENCIES.nullable(),
    warnings: z.array(z.string()),
  },
  handler: async (args, ctx) => {
    const hasLegacyField =
      args.vpkPath !== undefined ||
      args.previewPath !== undefined ||
      args.clearPreview ||
      args.title !== undefined ||
      args.description !== undefined ||
      args.tags !== undefined ||
      args.visibility !== undefined;
    const hasModernOnly =
      args.additionalPreviewPaths.length > 0 ||
      args.removeAdditionalPreviewIndexes.length > 0 ||
      args.additionalPreviewVideos.length > 0 ||
      args.contentDescriptors !== undefined ||
      args.keyValueTags !== undefined ||
      args.language !== undefined;
    const hasDependency =
      args.dependencies.length > 0 || args.removeDependencies.length > 0;
    if (!hasLegacyField && !hasModernOnly && !hasDependency) {
      throw new Error("give at least one field to change");
    }
    if (args.previewPath !== undefined && args.clearPreview) {
      throw new Error("pass previewPath or clearPreview, not both");
    }

    const warnings: string[] = [];
    const owned = await requireOwnedItem(args.itemId);
    const before = owned.item;

    const vpk = args.vpkPath === undefined ? undefined : vpkFile(args.vpkPath, ctx.config);
    const preview =
      args.previewPath === undefined
        ? undefined
        : imageFile(args.previewPath, ctx.config, "preview", false);
    const additional = args.additionalPreviewPaths.map((path) =>
      imageFile(path, ctx.config, "additional preview", true),
    );
    const videos = args.additionalPreviewVideos.map(videoId);
    const rawTags = args.tags;
    const tags = rawTags === undefined ? undefined : cleanTags(rawTags);
    if (tags !== undefined && rawTags !== undefined && tags.length !== rawTags.length) {
      warnings.push("duplicate or blank tags were removed");
    }
    if (args.tags !== undefined && tags !== undefined && tags.length === 0) {
      warnings.push("the tag list will be cleared");
    }
    for (const index of args.removeAdditionalPreviewIndexes) {
      if (index >= before.additionalPreviews.length) {
        throw new Error(
          `additional preview index ${index} is out of range; the item has ` +
            `${before.additionalPreviews.length} additional previews`,
        );
      }
    }
    if (args.dryRun) {
      return {
        dryRun: true,
        itemId: args.itemId,
        before,
        after: null,
        legacyUpdated: false,
        modernUpdated: false,
        dependencies: null,
        warnings,
      };
    }

    // Content and the legacy metadata fields are one commit. L4D2's ISteamUGC content
    // call cannot express this, so the helper is the only path that can change a VPK.
    const legacyUsed =
      vpk !== undefined ||
      preview !== undefined ||
      args.clearPreview ||
      args.title !== undefined ||
      args.description !== undefined ||
      tags !== undefined ||
      args.visibility !== undefined;
    if (legacyUsed) {
      await legacyUpdate(ctx.config, {
        itemId: args.itemId,
        ...(vpk === undefined ? {} : { vpk: vpk.path }),
        ...(preview === undefined ? {} : { preview }),
        ...(args.clearPreview ? { clearPreview: true } : {}),
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(tags === undefined ? {} : { tags }),
        ...(args.visibility === undefined
          ? {}
          : { visibility: visibilityNumber(args.visibility) }),
        ...(args.changeNote === undefined ? {} : { changeNote: args.changeNote }),
      });
    }

    const modern: Parameters<typeof updateWorkshopItemModern>[1] = {};
    if (!legacyUsed) {
      if (args.title !== undefined) modern.title = args.title;
      if (args.description !== undefined) modern.description = args.description;
      if (tags !== undefined) modern.tags = tags;
      if (args.visibility !== undefined) modern.visibility = visibilityNumber(args.visibility);
      if (args.changeNote !== undefined) modern.changeNote = args.changeNote;
    }
    if (additional.length > 0) modern.additionalPreviewPaths = additional;
    if (args.removeAdditionalPreviewIndexes.length > 0) {
      modern.removeAdditionalPreviewIndexes = args.removeAdditionalPreviewIndexes;
    }
    if (videos.length > 0) modern.additionalPreviewVideos = videos;
    if (args.contentDescriptors !== undefined) {
      modern.contentDescriptors = args.contentDescriptors;
    }
    if (args.keyValueTags !== undefined) modern.keyValueTags = args.keyValueTags;
    if (args.language !== undefined) modern.language = args.language;

    let modernUpdated = false;
    if (Object.keys(modern).length > 0) {
      await updateWorkshopItemModern(args.itemId, modern);
      modernUpdated = true;
    }

    let dependencyChange = null;
    if (hasDependency) {
      dependencyChange = await changeDependencies(
        args.itemId,
        dependencyIds(args.dependencies),
        dependencyIds(args.removeDependencies),
      );
      for (const failure of dependencyChange.failed) {
        warnings.push(`required item ${failure.id} was not changed: ${String(failure.code)}`);
      }
    }

    const after = await readWorkshopItem(args.itemId, {
      includeChildren: true,
      includeAdditionalPreviews: true,
    });
    return {
      dryRun: false,
      itemId: args.itemId,
      before,
      after,
      legacyUpdated: legacyUsed,
      modernUpdated,
      dependencies: dependencyChange,
      warnings,
    };
  },
});

export const deleteWorkshopItemTool = defineTool({
  name: "delete_workshop_item",
  description:
    "Permanently deletes an L4D2 Workshop item owned by the signed-in Steam account. The " +
    "deletion cannot be undone, and subscribers lose the item. `dryRun` reads and returns " +
    "the item without deleting it. Guarded; requires confirm:true. Refuses an item the " +
    "signed-in account does not own.",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    itemId: ITEM_ID,
    dryRun: z.boolean().default(false),
    confirm: CONFIRM,
  },
  outputSchema: {
    dryRun: z.boolean(),
    deleted: z.boolean(),
    item: ITEM.nullable(),
    url: z.string().nullable(),
  },
  handler: async (args, _ctx) => {
    const owned = await requireOwnedItem(args.itemId);
    if (args.dryRun) {
      return { dryRun: true, deleted: false, item: owned.item, url: owned.item.url };
    }
    await deleteWorkshopItem(args.itemId);
    return { dryRun: false, deleted: true, item: owned.item, url: owned.item.url };
  },
});

export const workshopPublishTools = [
  readWorkshopAccountTool,
  readWorkshopItemsTool,
  readWorkshopItemTool,
  publishWorkshopItemTool,
  updateWorkshopItemTool,
  deleteWorkshopItemTool,
];
