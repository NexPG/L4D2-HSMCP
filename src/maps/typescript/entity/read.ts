/**
 * One reader for a map's entities, whichever form the map is in.
 *
 * A `.vmf` keeps outputs in a `connections` sub-block; a compiled `.bsp` keeps them as
 * `On*` keyvalues. The two readers already exist (`readEntities` + `entityFromBlock`,
 * `readEntityLump`); this only chooses between them so a checker does not grow a third
 * copy of the choice. Outputs are preserved in `connections` for both forms.
 */
import { readFileSync } from "node:fs";
import { readEntityLump } from "../bsp/entities.js";
import { readEntities } from "../vmf/edit.js";
import { entityFromBlock } from "./model.js";
import type { MapEntity } from "./model.js";

export function readMapEntities(path: string): MapEntity[] {
  if (path.toLowerCase().endsWith(".bsp")) return readEntityLump(path).entities;
  const { entities } = readEntities(readFileSync(path, "utf8"));
  return entities.map((entity) => entityFromBlock(entity.block, entity.index));
}
