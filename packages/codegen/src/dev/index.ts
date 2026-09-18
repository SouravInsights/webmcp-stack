/**
 * The dashboard's building blocks, for hosts other than the dev server.
 *
 * The dev server (`webmcp-codegen dev`) and the site's hosted playground both
 * mount the same UI from the same state, so they read from here:
 *
 *   dashboardHtml    the page itself, as a string
 *   dashboardState   a pipeline run, shaped for the UI
 *   buildToolRequest a tool call, as a real HTTP request
 *
 * All three are safe in a browser bundle: no filesystem, no server-only
 * imports. Import from "@webmcp-stack/codegen/dev".
 */

export type { ToolRequest, ToolRequestResult, ToolRoute } from "./request.js";
export { buildToolRequest } from "./request.js";
export type { DashboardStateOptions, UiState, UiTool } from "./state.js";
export { dashboardState } from "./state.js";
export type { DashboardMode } from "./ui.js";
export { dashboardHtml } from "./ui.js";
