import { AuditLog as CoreAuditLog } from "@projectsociety/mcp-core";

/**
 * Audit entry kinds. Widens the shared base with this server's own vocabulary: it drives
 * a toolchain and writes map files, where a live-engine bridge does neither.
 */
export type AuditKind =
  | "server_start"
  | "tool_call"
  | "tool_result"
  | "file_write"
  | "vmf_edit"
  | "compile_start"
  | "compile_end"
  | "hammer_capture_failed"
  | "error";

/**
 * Append-only JSONL audit log, written to `<stateDir>/logs/audit.jsonl`.
 *
 * Writes are synchronous on purpose: volumes are low, and this server mutates map
 * sources and writes compiled output -- if it dies mid-action we want the record
 * of what it had already touched.
 */
export class AuditLog extends CoreAuditLog<AuditKind> {}

export type { AuditEntry } from "@projectsociety/mcp-core";
