import { describe, expect, it } from "vitest";
import { allTools } from "../../src/registry.js";

const READ = ["read_workshop_account", "read_workshop_items", "read_workshop_item"];
const WRITE = ["publish_workshop_item", "update_workshop_item", "delete_workshop_item"];

describe("Workshop tool registration", () => {
  it("registers the read tools and keeps them unguarded", () => {
    for (const name of READ) {
      const tool = allTools.find((candidate) => candidate.name === name);
      expect(tool, name).toBeDefined();
      expect(tool!.guarded ?? false, name).toBe(false);
    }
  });

  it("registers the write tools as guarded and declares confirm", () => {
    for (const name of WRITE) {
      const tool = allTools.find((candidate) => candidate.name === name);
      expect(tool, name).toBeDefined();
      expect(tool!.guarded, name).toBe(true);
      expect(Object.keys(tool!.inputSchema), name).toContain("confirm");
    }
  });

  it("names every Workshop write with an action verb, not read_", () => {
    for (const name of WRITE) expect(name.startsWith("read_")).toBe(false);
  });
});
