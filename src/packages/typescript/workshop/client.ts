/**
 * The Steam client bridge for Workshop work.
 *
 * `@hagicode/steamworks.js` owns everything ISteamUGC exposes: item queries, metadata,
 * additional previews, dependencies and deletion. It does not expose the legacy
 * `ISteamRemoteStorage` content calls, which is why `legacy.ts` exists, but every call here
 * goes through the library rather than a second implementation.
 *
 * **App id.** The client initialises as the L4D2 Authoring Tools (creator app 563), but an
 * item's `updateItem` call must pass the consumer app **550**. The library defaults to the
 * initialisation app, and 563 makes every update fail with `a parameter is invalid`. This
 * is measured on a live client, not inferred: 550 works, 563 and the default do not.
 */
import { createRequire } from "node:module";
import type * as Steamworks from "@hagicode/steamworks.js";
import { toItemView, VISIBILITY } from "./types.js";
import type { WorkshopItemView, WorkshopVisibility } from "./types.js";

const require = createRequire(import.meta.url);

/** Left 4 Dead 2. The consumer app, and the app id every UGC update must pass. */
export const L4D2_CONSUMER_APP_ID = 550;
/** Left 4 Dead 2 Authoring Tools. The creator app the Steam client initialises as. */
export const L4D2_CREATOR_APP_ID = 563;

type SteamworksModule = typeof Steamworks;
type SteamClient = ReturnType<SteamworksModule["init"]>;

let moduleCache: SteamworksModule | null = null;
let clientCache: SteamClient | null = null;

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function steamworksModule(): SteamworksModule {
  if (moduleCache === null) {
    try {
      moduleCache = require("@hagicode/steamworks.js") as SteamworksModule;
    } catch (error) {
      throw new Error(
        "The Steam Workshop binding is not installed. Run `pnpm install` in the toolkit " +
          `directory. (${errorMessage(error)})`,
      );
    }
  }
  return moduleCache;
}

/** The bundled 64-bit Steam API, used by the compiled legacy helper. */
export function steamApiDllPath(): string | null {
  try {
    return require.resolve("@hagicode/steamworks.js/dist/win64/steam_api64.dll");
  } catch {
    return null;
  }
}

export function steamClient(): SteamClient {
  if (clientCache === null) {
    try {
      clientCache = steamworksModule().init(L4D2_CREATOR_APP_ID);
    } catch (error) {
      throw new Error(
        "Steam is not reachable. Start the Steam client, sign in, and retry. The Workshop " +
          `tools use the running client and never ask for a password. (${errorMessage(error)})`,
      );
    }
  }
  return clientCache;
}

/** Releases the client. Used by tests; the server keeps it for its lifetime. */
export function shutdownSteam(): void {
  if (clientCache === null) return;
  try {
    steamworksModule().shutdown();
  } finally {
    clientCache = null;
  }
}

export interface SteamAccount {
  steamId64: string;
  steamId32: string;
  accountId: number;
  personaName: string;
}

export function steamAccount(): SteamAccount {
  const client = steamClient();
  const id = client.localplayer.getSteamId();
  let personaName = "";
  try {
    personaName = client.localplayer.getName();
  } catch {
    // A connected client can still lack a persona name for a moment; the ids are enough.
  }
  return {
    steamId64: id.steamId64.toString(),
    steamId32: id.steamId32,
    accountId: id.accountId,
    personaName,
  };
}

export type WorkshopListKind = "published" | "subscribed" | "favorites" | "played";
export type WorkshopSort = "lastUpdated" | "created" | "title";

const LIST_TYPE: Record<WorkshopListKind, number> = {
  published: 0,
  subscribed: 5,
  favorites: 4,
  played: 6,
};

const SORT_ORDER: Record<WorkshopSort, number> = {
  lastUpdated: 3,
  created: 1,
  title: 2,
};

export interface ListWorkshopOptions {
  kind?: WorkshopListKind;
  page?: number;
  all?: boolean;
  limit?: number;
  search?: string;
  sort?: WorkshopSort;
}

export interface ListWorkshopResult {
  items: WorkshopItemView[];
  /** Items after the local search, before the limit. */
  total: number;
  /** Steam's total for the list, ignoring the local search. */
  steamTotal: number;
  pages: number;
  truncated: boolean;
}

/**
 * Lists the signed-in account's items. Steam's first page is 1; page 0 fails to create the
 * query. `search` is applied locally because the user-list query ignores `searchText`.
 */
export async function listWorkshopItems(
  options: ListWorkshopOptions = {},
): Promise<ListWorkshopResult> {
  const client = steamClient();
  const account = steamAccount();
  const kind = options.kind ?? "published";
  const sort = options.sort ?? "lastUpdated";
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const collectAll = options.all === true || options.search !== undefined;
  let page = Math.max(1, options.page ?? 1);
  const items: WorkshopItemView[] = [];
  let steamTotal = 0;
  let pages = 0;

  while (pages < 40) {
    let result;
    try {
      result = await client.workshop.getUserItems(
        page,
        account.accountId,
        LIST_TYPE[kind],
        0, // UGCType.Items
        SORT_ORDER[sort],
        { creator: L4D2_CREATOR_APP_ID, consumer: L4D2_CONSUMER_APP_ID },
        { returnChildren: false, includeAdditionalPreviews: false },
      );
    } catch (error) {
      throw new Error(`Steam could not list Workshop items: ${errorMessage(error)}`);
    }
    pages += 1;
    steamTotal = result.totalResults;
    for (const item of result.items) {
      if (item !== null && item !== undefined) items.push(toItemView(item));
    }
    if (!collectAll) break;
    if (result.returnedResults === 0 || pages >= 40) break;
    if (items.length >= limit || items.length >= steamTotal) break;
    page += 1;
  }

  const needle = options.search?.trim().toLowerCase() ?? "";
  const filtered =
    needle.length === 0
      ? items
      : items.filter((item) =>
          `${item.title}\n${item.description}`.toLowerCase().includes(needle),
        );
  return {
    items: filtered.slice(0, limit),
    total: filtered.length,
    steamTotal,
    pages,
    truncated: filtered.length > limit,
  };
}

export interface ReadWorkshopItemOptions {
  includeChildren?: boolean;
  includeAdditionalPreviews?: boolean;
  language?: string;
}

export async function readWorkshopItem(
  itemId: string,
  options: ReadWorkshopItemOptions = {},
): Promise<WorkshopItemView> {
  const client = steamClient();
  let item;
  try {
    item = await client.workshop.getItem(BigInt(itemId), {
      returnChildren: options.includeChildren ?? true,
      includeAdditionalPreviews: options.includeAdditionalPreviews ?? true,
      includeLongDescription: true,
      ...(options.language === undefined ? {} : { language: options.language }),
    });
  } catch (error) {
    throw new Error(`Steam could not read Workshop item ${itemId}: ${errorMessage(error)}`);
  }
  if (item === null) {
    throw new Error(
      `Workshop item ${itemId} was not found, or it is not visible to this account. A ` +
        "private item is visible only to its owner.",
    );
  }
  return toItemView(item);
}

/**
 * Refuses an item the signed-in account does not own before a write. Steam would refuse
 * too, but the error would be a bare result code after the upload had already started.
 */
export async function requireOwnedItem(itemId: string): Promise<{
  item: WorkshopItemView;
  account: SteamAccount;
}> {
  const account = steamAccount();
  const item = await readWorkshopItem(itemId, {
    includeChildren: true,
    includeAdditionalPreviews: true,
  });
  if (item.ownerSteamId !== account.steamId64) {
    throw new Error(
      `Workshop item ${itemId} belongs to SteamID ${item.ownerSteamId}, not the signed-in ` +
        `account ${account.steamId64}. Refusing to change someone else's item.`,
    );
  }
  return { item, account };
}

export interface DependencyChange {
  before: string[];
  after: string[];
  added: string[];
  removed: string[];
  failed: Array<{ id: string; code: number | string }>;
}

export async function changeDependencies(
  itemId: string,
  add: readonly string[],
  remove: readonly string[],
): Promise<DependencyChange> {
  const client = steamClient();
  const current = await readWorkshopItem(itemId, {
    includeChildren: true,
    includeAdditionalPreviews: false,
  });
  const before = new Set(current.children);
  const after = new Set(before);
  const failed: DependencyChange["failed"] = [];

  for (const id of add) {
    if (!/^\d+$/.test(id)) throw new Error(`dependency ${id} is not a published file id`);
    if (after.has(id)) continue;
    try {
      const code = await client.workshop.addDependency(BigInt(itemId), BigInt(id));
      if (code === 1) after.add(id);
      else failed.push({ id, code });
    } catch (error) {
      failed.push({ id, code: errorMessage(error) });
    }
  }

  for (const id of remove) {
    if (!/^\d+$/.test(id)) throw new Error(`dependency ${id} is not a published file id`);
    if (!after.has(id)) continue;
    try {
      const code = await client.workshop.removeDependency(BigInt(itemId), BigInt(id));
      if (code === 1) after.delete(id);
      else failed.push({ id, code });
    } catch (error) {
      failed.push({ id, code: errorMessage(error) });
    }
  }

  return {
    before: [...before],
    after: [...after],
    added: [...after].filter((id) => !before.has(id)),
    removed: [...before].filter((id) => !after.has(id)),
    failed,
  };
}

export interface ModernUpdateResult {
  itemId: string;
  needsAgreement: boolean;
}

/**
 * Applies the fields only ISteamUGC can set: additional previews and videos, content
 * descriptors, key-value tags and language. The consumer app id 550 is mandatory.
 */
export async function updateWorkshopItemModern(
  itemId: string,
  update: Steamworks.workshop.UgcUpdate,
): Promise<ModernUpdateResult> {
  try {
    const result = await steamClient().workshop.updateItem(
      BigInt(itemId),
      update,
      L4D2_CONSUMER_APP_ID,
    );
    return {
      itemId: result.itemId.toString(),
      needsAgreement: result.needsToAcceptAgreement,
    };
  } catch (error) {
    throw new Error(
      `Steam refused the metadata update for item ${itemId}: ${errorMessage(error)}`,
    );
  }
}

export function visibilityNumber(value: WorkshopVisibility): number {
  return VISIBILITY[value];
}

export async function deleteWorkshopItem(itemId: string): Promise<void> {
  try {
    await steamClient().workshop.deleteItem(BigInt(itemId));
  } catch (error) {
    throw new Error(`Steam refused to delete item ${itemId}: ${errorMessage(error)}`);
  }
}
