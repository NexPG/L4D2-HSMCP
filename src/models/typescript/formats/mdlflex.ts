/**
 * Flex descriptors, controllers, rules and per-vertex deltas from a version-49 `.mdl`.
 *
 * The MDL stores flexes in two places: the header names descriptors/controllers/rules, and
 * each mesh record points at `mstudioflex_t` records with `mstudiovertanim_t` deltas. The
 * deltas are 16-bit fixed point with a 1/4096 scale and are relative to the mesh's LOD-0
 * vertex range; the caller adds the mesh's global vertex start.
 *
 * A VTA is the compiler input that carries these deltas, so this module only reads; the
 * decompiler writes the `.vta` and the `flexfile`/`flexcontroller`/flex-rule lines.
 */
export type Vec3 = [number, number, number];

export interface FlexVertex {
  /** Mesh-relative LOD-0 vertex index; the caller adds the mesh's global start. */
  index: number;
  delta: Vec3;
  normalDelta: Vec3;
}

export interface MdlFlex {
  flexDesc: number;
  /** Partner descriptor for a left/right pair, or 0. */
  flexPair: number;
  /** 0 = position/normal, 1 = wrinkle (an extra int16 per vertex). */
  vertAnimType: number;
  vertices: FlexVertex[];
}

export interface MdlFlexController {
  name: string;
  type: string;
  min: number;
  max: number;
}

export interface MdlFlexOp {
  op: number;
  index: number;
  value: number;
}

export interface MdlFlexRule {
  flex: number;
  ops: MdlFlexOp[];
}

export interface MdlFlexData {
  descriptors: string[];
  controllers: MdlFlexController[];
  rules: MdlFlexRule[];
}

/** `g_VertAnimFixedPointScale` in the engine. */
export const VERT_ANIM_SCALE = 1 / 4096;

const FLEX_SIZE = 60;
const FLEX_DESC_SIZE = 4;
const FLEX_CONTROLLER_SIZE = 20;
const FLEX_RULE_SIZE = 12;
const FLEX_OP_SIZE = 8;

function readName(bytes: Buffer, offset: number): string {
  if (offset <= 0 || offset >= bytes.length) return "";
  const end = bytes.indexOf(0, offset);
  return bytes.subarray(offset, end < 0 ? bytes.length : end).toString("latin1");
}

/** Reads the header's descriptor/controller/rule lists. */
export function readFlexHeader(mdl: Buffer): MdlFlexData {
  if (mdl.length < 284) return { descriptors: [], controllers: [], rules: [] };
  const descriptorCount = mdl.readInt32LE(260);
  const descriptorOffset = mdl.readInt32LE(264);
  const descriptors: string[] = [];
  if (descriptorCount > 0 && descriptorCount < 10_000 && descriptorOffset > 0) {
    for (let i = 0; i < descriptorCount; i += 1) {
      const base = descriptorOffset + i * FLEX_DESC_SIZE;
      if (base + FLEX_DESC_SIZE > mdl.length) break;
      descriptors.push(readName(mdl, base + mdl.readInt32LE(base)) || `flex_${i}`);
    }
  }

  const controllerCount = mdl.readInt32LE(268);
  const controllerOffset = mdl.readInt32LE(272);
  const controllers: MdlFlexController[] = [];
  if (controllerCount > 0 && controllerCount < 10_000 && controllerOffset > 0) {
    for (let i = 0; i < controllerCount; i += 1) {
      const base = controllerOffset + i * FLEX_CONTROLLER_SIZE;
      if (base + FLEX_CONTROLLER_SIZE > mdl.length) break;
      controllers.push({
        type: readName(mdl, base + mdl.readInt32LE(base)) || "default",
        name: readName(mdl, base + mdl.readInt32LE(base + 4)) || `controller_${i}`,
        min: mdl.readFloatLE(base + 12),
        max: mdl.readFloatLE(base + 16),
      });
    }
  }

  const ruleCount = mdl.readInt32LE(276);
  const ruleOffset = mdl.readInt32LE(280);
  const rules: MdlFlexRule[] = [];
  if (ruleCount > 0 && ruleCount < 100_000 && ruleOffset > 0) {
    for (let i = 0; i < ruleCount; i += 1) {
      const base = ruleOffset + i * FLEX_RULE_SIZE;
      if (base + FLEX_RULE_SIZE > mdl.length) break;
      const flex = mdl.readInt32LE(base);
      const opCount = mdl.readInt32LE(base + 4);
      const opOffset = mdl.readInt32LE(base + 8);
      const ops: MdlFlexOp[] = [];
      for (let k = 0; k < opCount; k += 1) {
        const at = base + opOffset + k * FLEX_OP_SIZE;
        if (at + FLEX_OP_SIZE > mdl.length) break;
        ops.push({
          op: mdl.readInt32LE(at),
          index: mdl.readInt32LE(at + 4),
          value: mdl.readFloatLE(at + 4),
        });
      }
      rules.push({ flex, ops });
    }
  }

  return { descriptors, controllers, rules };
}

/** Reads the flex records a mesh's `flexindex` points at. */
export function readMeshFlexes(mdl: Buffer, meshBase: number): MdlFlex[] {
  if (meshBase < 0 || meshBase + 24 > mdl.length) return [];
  const count = mdl.readInt32LE(meshBase + 16);
  const offset = mdl.readInt32LE(meshBase + 20);
  if (count <= 0 || count > 10_000 || offset <= 0) return [];
  const flexes: MdlFlex[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = meshBase + offset + i * FLEX_SIZE;
    if (base + FLEX_SIZE > mdl.length) break;
    const numVerts = mdl.readInt32LE(base + 20);
    const vertOffset = mdl.readInt32LE(base + 24);
    const vertAnimType = mdl[base + 32]!;
    const stride = vertAnimType === 1 ? 18 : 16;
    const vertices: FlexVertex[] = [];
    for (let v = 0; v < numVerts; v += 1) {
      const at = base + vertOffset + v * stride;
      if (at + stride > mdl.length) break;
      vertices.push({
        index: mdl.readUInt16LE(at),
        delta: [
          mdl.readInt16LE(at + 4) * VERT_ANIM_SCALE,
          mdl.readInt16LE(at + 6) * VERT_ANIM_SCALE,
          mdl.readInt16LE(at + 8) * VERT_ANIM_SCALE,
        ],
        normalDelta: [
          mdl.readInt16LE(at + 10) * VERT_ANIM_SCALE,
          mdl.readInt16LE(at + 12) * VERT_ANIM_SCALE,
          mdl.readInt16LE(at + 14) * VERT_ANIM_SCALE,
        ],
      });
    }
    flexes.push({
      flexDesc: mdl.readInt32LE(base),
      flexPair: mdl.readInt32LE(base + 28),
      vertAnimType,
      vertices,
    });
  }
  return flexes;
}

/**
 * Converts one flex rule's postfix ops into a QC expression such as `%presser = presser`.
 *
 * Only the operators the engine documents as arithmetic are handled; an op this reader does
 * not know returns null, and the caller reports the rule as skipped instead of writing a
 * wrong equation.
 */
export function flexRuleExpression(rule: MdlFlexRule, data: MdlFlexData): string | null {
  interface Item {
    text: string;
    precedence: number;
  }
  const stack: Item[] = [];
  const number = (value: number): string => Number(value.toFixed(6)).toString();
  const binary = (operator: string, precedence: number): boolean => {
    if (stack.length < 2) return false;
    const right = stack.pop()!;
    const left = stack.pop()!;
    const rightText = right.precedence < precedence ? `(${right.text})` : right.text;
    const leftText = left.precedence < precedence ? `(${left.text})` : left.text;
    stack.push({ text: `${leftText} ${operator} ${rightText}`, precedence });
    return true;
  };

  for (const op of rule.ops) {
    switch (op.op) {
      case 1:
        stack.push({ text: number(op.value), precedence: 10 });
        break;
      case 2: {
        const controller = data.controllers[op.index];
        if (!controller) return null;
        stack.push({ text: controller.name, precedence: 10 });
        break;
      }
      case 3: {
        const descriptor = data.descriptors[op.index];
        if (!descriptor) return null;
        stack.push({ text: `%${descriptor}`, precedence: 10 });
        break;
      }
      case 4:
        if (!binary("+", 1)) return null;
        break;
      case 5:
        if (!binary("-", 1)) return null;
        break;
      case 6:
        if (!binary("*", 2)) return null;
        break;
      case 7:
        if (!binary("/", 2)) return null;
        break;
      case 8: {
        const value = stack.pop();
        if (!value) return null;
        stack.push({ text: `-(${value.text})`, precedence: 2 });
        break;
      }
      default:
        return null;
    }
  }
  return stack.length === 1 ? stack[0]!.text : null;
}
