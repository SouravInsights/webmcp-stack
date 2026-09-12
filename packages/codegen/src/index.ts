/**
 * webmcp-codegen public API.
 *
 * Most people only ever need `defineConfig`. Sources and outputs live
 * behind their own subpaths ("@webmcp-stack/codegen/sources", ".../outputs")
 * so the top-level import stays small.
 */

export { defineConfig } from "./config.js";
export type { GenerateOptions, GenerateResult } from "./pipeline.js";
export { runGenerate } from "./pipeline.js";
export type {
  AuditFinding,
  CandidateTool,
  CodegenConfig,
  GeneratedFile,
  JsonSchema,
  Output,
  ReviewedTool,
  RiskTier,
  SafetyOptions,
  SideEffect,
  Source,
  SourceKind,
  ToolHints,
} from "./types.js";
