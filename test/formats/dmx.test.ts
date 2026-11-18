/**
 * DMX round-trip, through the real sidecar.
 *
 * The point of these tests is not "a file appeared". It is that a tree written by an agent
 * comes back with the same types and values, that KeyValues2 and binary are both readable,
 * and that a type this server does not understand is refused instead of written as
 * something else. The last one matters most: a DMX the game misreads fails silently.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { callSidecar } from "../../src/core/typescript/sidecar/client.js";
import { has, config } from "../support/env.js";

const scratch = mkdtempSync(join(tmpdir(), "hammer-dmx-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const TREE = {
  name: "root",
  type: "DmElement",
  attributes: {
    name: { type: "string", value: "probe" },
    flag: { type: "bool", value: true },
    count: { type: "int", value: 7 },
    weights: { type: "float", array: true, values: [0.25, 0.75] },
    child: {
      type: "element",
      value: {
        name: "child",
        type: "DmeMesh",
        attributes: { label: { type: "string", value: "mesh" } },
      },
    },
  },
} as const;

interface ReadResult {
  read: boolean;
  encoding: string;
  encodingVersion: number;
  format: string;
  formatVersion: number;
  elementCount: number;
  elementTypes: Record<string, number>;
  tree: { attributes: Record<string, { value?: unknown; values?: unknown[]; element?: { attributes: Record<string, { value?: unknown }> } }> };
}

const installed = has.sidecar;

describe.skipIf(!installed)("read_dmx / write_dmx", () => {
  it("round-trips binary v4 with the types intact", async () => {
    const path = join(scratch, "probe.dmx");
    const write = await callSidecar<{ written: boolean; verified: boolean; bytes: number }>(
      "dmx_write",
      { path, tree: TREE, version: 4, format: "model", formatVersion: 15 },
      config,
    );
    expect(write.written).toBe(true);
    expect(write.verified).toBe(true);
    expect(write.bytes).toBeGreaterThan(100);

    const read = await callSidecar<ReadResult>("dmx_read", { path }, config);
    expect(read.read).toBe(true);
    expect(read.encoding).toBe("binary");
    expect(read.encodingVersion).toBe(4);
    expect(read.format).toBe("model");
    expect(read.formatVersion).toBe(15);
    // DmElement, DmeMesh and the implicit child of the element attribute.
    expect(read.elementCount).toBeGreaterThanOrEqual(2);
    expect(read.elementTypes.DmeMesh).toBe(1);

    const attrs = read.tree.attributes;
    expect(attrs.name!.value).toBe("probe");
    expect(attrs.flag!.value).toBe(true);
    expect(attrs.count!.value).toBe(7);
    expect(attrs.weights!.values).toEqual([0.25, 0.75]);
    expect(attrs.child!.element!.attributes.label!.value).toBe("mesh");
  });

  it("writes KeyValues2 text when asked, and reads it back", async () => {
    const path = join(scratch, "probe_kv2.dmx");
    await callSidecar("dmx_write", { path, tree: TREE, encoding: "kv2" }, config);
    const head = readFileSync(path, "utf8").slice(0, 80);
    expect(head).toContain("encoding keyvalues2");
    expect(head).toContain("format model 15");

    const read = await callSidecar<ReadResult>("dmx_read", { path }, config);
    expect(read.read).toBe(true);
    expect(read.tree.attributes.name!.value).toBe("probe");
  });

  it("keeps a reference to an element instead of expanding a cycle", async () => {
    // A model graph is cyclic: the DmeModel contains a DmeTransformList that points back.
    // Expanding it fully would never terminate, so arrays and deep levels stay references.
    const path = join(scratch, "array.dmx");
    const tree = {
      name: "root",
      type: "DmElement",
      attributes: {
        children: {
          type: "element",
          array: true,
          values: [
            { name: "a", type: "DmeDag", attributes: {} },
            { name: "b", type: "DmeDag", attributes: {} },
          ],
        },
      },
    };
    await callSidecar("dmx_write", { path, tree }, config);
    const read = await callSidecar<ReadResult>("dmx_read", { path }, config);
    const children = read.tree.attributes.children as unknown as {
      count: number;
      values: { name: string; type: string; uuid: string }[];
    };
    expect(children.count).toBe(2);
    expect(children.values.map((v) => v.name)).toEqual(["a", "b"]);
    expect(children.values[0]!.uuid).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses an unknown attribute type with the list of known ones", async () => {
    const path = join(scratch, "bad.dmx");
    await expect(
      callSidecar(
        "dmx_write",
        { path, tree: { name: "root", type: "DmElement", attributes: { x: { type: "colour", value: 1 } } } },
        config,
      ),
    ).rejects.toThrow(/known types are/);
  });
});
