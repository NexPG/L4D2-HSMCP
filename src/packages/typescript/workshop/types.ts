/**
 * The shape a Workshop tool returns. Steamworks hands out `bigint` ids, which JSON cannot
 * carry, and numeric enums, which read badly in a tool result; this module is the one place
 * that converts both. It has no Steam dependency, so tests can map a fixture item.
 */
import type * as Steamworks from "@hagicode/steamworks.js";

export type WorkshopVisibility = "public" | "friends" | "private" | "unlisted";

export const VISIBILITY: Record<WorkshopVisibility, number> = {
  public: 0,
  friends: 1,
  private: 2,
  unlisted: 3,
};

const VISIBILITY_NAME: Record<number, WorkshopVisibility> = {
  0: "public",
  1: "friends",
  2: "private",
  3: "unlisted",
};

export function visibilityName(value: number): WorkshopVisibility {
  return VISIBILITY_NAME[value] ?? "private";
}

export interface WorkshopPreviewView {
  urlOrVideoId: string;
  originalFilename: string;
  kind:
    | "image"
    | "youtube"
    | "sketchfab"
    | "environmentMapHorizontalCross"
    | "environmentMapLatLong"
    | "clip"
    | "unknown";
}

export interface WorkshopItemStats {
  subscriptions: number;
  favorites: number;
  followers: number;
  uniqueSubscriptions: number;
  uniqueFavorites: number;
  uniqueFollowers: number;
  websiteViews: number;
  comments: number;
}

export interface WorkshopItemView {
  id: string;
  title: string;
  description: string;
  visibility: WorkshopVisibility;
  tags: string[];
  tagsTruncated: boolean;
  previewUrl: string | null;
  additionalPreviews: WorkshopPreviewView[];
  children: string[];
  numChildren: number;
  url: string;
  ownerSteamId: string;
  creatorAppId: number | null;
  consumerAppId: number | null;
  timeCreated: number;
  timeUpdated: number;
  banned: boolean;
  acceptedForUse: boolean;
  supportedGameVersions: Array<{ minBranch: string | null; maxBranch: string | null }>;
  statistics: WorkshopItemStats;
}

function count(value: bigint | undefined): number {
  return value === undefined ? 0 : Number(value);
}

function previewKind(value: number): WorkshopPreviewView["kind"] {
  switch (value) {
    case 0:
      return "image";
    case 1:
      return "youtube";
    case 2:
      return "sketchfab";
    case 3:
      return "environmentMapHorizontalCross";
    case 4:
      return "environmentMapLatLong";
    case 5:
      return "clip";
    default:
      return "unknown";
  }
}

export function toItemView(item: Steamworks.workshop.WorkshopItem): WorkshopItemView {
  const stats = item.statistics;
  // A legacy-published item comes back with an empty `url`; the canonical page is still
  // addressable by id, and an empty string is not a useful answer for an agent.
  const url =
    item.url.length > 0
      ? item.url
      : `https://steamcommunity.com/sharedfiles/filedetails/?id=${item.publishedFileId}`;
  return {
    id: item.publishedFileId.toString(),
    title: item.title,
    description: item.description,
    visibility: visibilityName(item.visibility),
    tags: [...item.tags],
    tagsTruncated: item.tagsTruncated,
    previewUrl: item.previewUrl ?? null,
    additionalPreviews: (item.additionalPreviews ?? []).map((preview) => ({
      urlOrVideoId: preview.urlOrVideoId,
      originalFilename: preview.originalFilename,
      kind: previewKind(preview.previewType),
    })),
    children: (item.children ?? []).map((child) => child.toString()),
    numChildren: item.numChildren,
    url,
    ownerSteamId: item.owner.steamId64.toString(),
    creatorAppId: item.creatorAppId ?? null,
    consumerAppId: item.consumerAppId ?? null,
    timeCreated: item.timeCreated,
    timeUpdated: item.timeUpdated,
    banned: item.banned,
    acceptedForUse: item.acceptedForUse,
    supportedGameVersions: item.supportedGameVersions.map((range) => ({
      minBranch: range.minBranch ?? null,
      maxBranch: range.maxBranch ?? null,
    })),
    statistics: {
      subscriptions: count(stats.numSubscriptions),
      favorites: count(stats.numFavorites),
      followers: count(stats.numFollowers),
      uniqueSubscriptions: count(stats.numUniqueSubscriptions),
      uniqueFavorites: count(stats.numUniqueFavorites),
      uniqueFollowers: count(stats.numUniqueFollowers),
      websiteViews: count(stats.numUniqueWebsiteViews),
      comments: count(stats.numComments),
    },
  };
}
