import { describe, expect, it } from "vitest";
import type * as Steamworks from "@hagicode/steamworks.js";
import { toItemView, visibilityName } from "../../src/packages/typescript/workshop/types.js";

function fixture(overrides: Partial<Steamworks.workshop.WorkshopItem> = {}): Steamworks.workshop.WorkshopItem {
  return {
    publishedFileId: 1234567890n,
    creatorAppId: 563,
    consumerAppId: 550,
    title: "Example Addon",
    description: "Example description for a fixture.",
    owner: { steamId64: 111111111111111111n, steamId32: "STEAM_0:0:11111111", accountId: 11111111 },
    timeCreated: 1_700_000_000,
    timeUpdated: 1_700_000_100,
    timeAddedToUserList: 0,
    visibility: 2,
    banned: false,
    acceptedForUse: false,
    tags: ["Scripts"],
    tagsTruncated: false,
    url: "",
    numUpvotes: 0,
    numDownvotes: 0,
    numChildren: 1,
    previewUrl: "https://example.invalid/preview.jpg",
    statistics: { numSubscriptions: 3n, numFavorites: 1n, numUniqueWebsiteViews: 7n },
    children: [987654321n],
    additionalPreviews: [
      { urlOrVideoId: "https://example.invalid/extra.jpg", originalFilename: "extra.jpg", previewType: 0 },
      { urlOrVideoId: "dQw4w9WgXcQ", originalFilename: "", previewType: 1 },
      { urlOrVideoId: "unknown", originalFilename: "", previewType: 255 },
    ],
    supportedGameVersions: [{ minBranch: "open_beta" }],
    ...overrides,
  };
}

describe("Workshop item view", () => {
  it("maps Steam's numeric visibility to its name", () => {
    expect(visibilityName(0)).toBe("public");
    expect(visibilityName(1)).toBe("friends");
    expect(visibilityName(2)).toBe("private");
    expect(visibilityName(3)).toBe("unlisted");
    expect(visibilityName(9)).toBe("private");
  });

  it("turns bigint ids into strings JSON can carry", () => {
    const view = toItemView(fixture());
    expect(view.id).toBe("1234567890");
    expect(view.ownerSteamId).toBe("111111111111111111");
    expect(view.children).toEqual(["987654321"]);
  });

  it("builds the canonical page URL when Steam returns an empty one", () => {
    expect(toItemView(fixture()).url).toBe(
      "https://steamcommunity.com/sharedfiles/filedetails/?id=1234567890",
    );
    expect(toItemView(fixture({ url: "https://steamcommunity.com/sharedfiles/filedetails/?id=1" })).url).toBe(
      "https://steamcommunity.com/sharedfiles/filedetails/?id=1",
    );
  });

  it("maps additional preview kinds and keeps the video id", () => {
    const view = toItemView(fixture());
    expect(view.additionalPreviews).toEqual([
      { urlOrVideoId: "https://example.invalid/extra.jpg", originalFilename: "extra.jpg", kind: "image" },
      { urlOrVideoId: "dQw4w9WgXcQ", originalFilename: "", kind: "youtube" },
      { urlOrVideoId: "unknown", originalFilename: "", kind: "unknown" },
    ]);
  });

  it("reads only the statistics Steam returned, as numbers", () => {
    const view = toItemView(fixture());
    expect(view.statistics.subscriptions).toBe(3);
    expect(view.statistics.favorites).toBe(1);
    expect(view.statistics.websiteViews).toBe(7);
    expect(view.statistics.followers).toBe(0);
  });
});
