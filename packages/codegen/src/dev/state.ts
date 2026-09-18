/**
 * The dashboard's data shape, and the one function that builds it.
 *
 * Two dashboards render this state: the local dev server
 * (`webmcp-codegen dev`) and the hosted playground on the site. Both read
 * from this module, so the hosted playground is the same product as the
 * local one instead of a copy that drifts.
 *
 * Nothing here touches the filesystem, so a browser bundle can import it.
 */

import type {
  AuditFinding,
  GeneratedFile,
  JsonSchema,
  ReviewedTool,
  SkippedEndpoint,
  ToolOverrides,
} from "../types.js";

export interface UiTool {
  name: string;
  description: string;
  sideEffect: string;
  enabled: boolean;
  endpointRole: string;
  piiInOutput: string[];
  findings: { level: string; message: string }[];
  inputSchema?: JsonSchema;
  serverUrl?: string;
  requiresAuth?: boolean;
  verb?: string;
  path?: string;
  /** Where this tool came from: the route, the schema, or both ("merged"). */
  provenance?: string;
  /** Present when the tool annotates a form instead of generating a file. */
  form?: { path: string };
  /** Per-field text the developer overrode, so the editor shows their words. */
  fieldOverrides?: Record<string, string>;
  /** The generated file, shown on demand. The dashboard is the disclosure. */
  source?: { fileName: string; code: string };
  /** How dangerous the tool is to expose to agents. */
  riskTier?: string;
  /** A withheld tool is not registered at all; agents never see it. */
  withheld?: boolean;
  /** Route facts the "run it" test needs to build a real request. */
  pathTemplate?: string;
  paramLocations?: { path: string[]; query: string[]; body: string[] };
}

export interface UiState {
  label: string;
  outDir?: string;
  tools: UiTool[];
  skipped: { ref: string; reason: string }[];
  notes: string[];
}

export interface DashboardStateOptions {
  /** What the spec is called, shown in the sidebar. */
  label: string;
  /** Where the tools would land, shown in the sidebar. */
  outDir?: string;
  /** Hand-authored tweaks, so the editor shows the developer's own words. */
  overrides?: ToolOverrides;
}

/**
 * The dashboard state for one pipeline run. Takes the pieces of a
 * GenerateResult the UI actually renders: a run's files and findings are
 * what put source code and audit warnings on screen.
 */
export function dashboardState(
  run: {
    tools: ReviewedTool[];
    files: GeneratedFile[];
    skipped: SkippedEndpoint[];
    notes: string[];
    findings: AuditFinding[];
  },
  options: DashboardStateOptions,
): UiState {
  return {
    label: options.label,
    outDir: options.outDir,
    tools: run.tools.map((tool) => toUiTool(tool, run.findings, run.files, options.overrides)),
    skipped: run.skipped,
    notes: run.notes,
  };
}

function toUiTool(
  tool: ReviewedTool,
  findings: AuditFinding[],
  files: GeneratedFile[],
  overrides: ToolOverrides | undefined,
): UiTool {
  // Route info only exists for endpoint-backed tools. A standalone schema
  // tool has no verb, and showing one would be a lie; the provenance line
  // carries the truth instead ("schema: create-trip").
  const route = tool.endpointRef ?? (tool.source.kind === "openapi" ? tool.source.ref : "");
  const [verb, ...rest] = route ? route.split(" ") : [undefined, ""];
  // Provenance names where the tool came from, exactly once. The route line
  // owns the verb and path, so a merged tool names only its schema, and a
  // pure OpenAPI tool has nothing left to say: no line at all.
  const provenance = tool.endpointRef
    ? `merged: the ${tool.source.ref} schema and this route`
    : tool.source.kind === "schema"
      ? `schema: ${tool.source.ref}`
      : "";
  // The dry run already holds every file's contents in memory, so the
  // dashboard can show the real generated source per tool - the same
  // progressive disclosure the site's demo has, against live output.
  const fileName = `${tool.name}.webmcp.ts`;
  const file = files.find((candidate) => baseName(candidate.path) === fileName);
  return {
    name: tool.name,
    verb,
    path: rest.join(" "),
    provenance,
    ...(tool.form ? { form: tool.form } : {}),
    description: tool.description,
    sideEffect: tool.sideEffect,
    riskTier: tool.riskTier,
    enabled: tool.enabledByDefault,
    withheld: tool.withheld,
    endpointRole: tool.endpointRole,
    piiInOutput: tool.piiInOutput,
    inputSchema: tool.inputSchema,
    ...(overrides?.[tool.name]?.fields ? { fieldOverrides: overrides[tool.name]?.fields } : {}),
    ...(tool.pathTemplate ? { pathTemplate: tool.pathTemplate } : {}),
    ...(tool.paramLocations ? { paramLocations: tool.paramLocations } : {}),
    ...(tool.serverUrl ? { serverUrl: tool.serverUrl } : {}),
    requiresAuth: tool.requiresAuth,
    ...(file ? { source: { fileName, code: file.contents } } : {}),
    findings: findings
      .filter((finding) => finding.tool === tool.name)
      .map((finding) => ({ level: finding.level, message: finding.message })),
  };
}

/** The last path segment. Spelled out so this module stays browser-safe. */
function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut === -1 ? path : path.slice(cut + 1);
}
