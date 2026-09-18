import { describe, expect, it } from "vitest";
import type { AuditFinding, GeneratedFile, ReviewedTool } from "../types.js";
import { dashboardState } from "./state.js";

/** A reviewed tool, as the safety layer would have produced it. */
function reviewedTool(overrides: Partial<ReviewedTool> = {}): ReviewedTool {
  return {
    id: "GET /albums",
    name: "get-all-albums",
    source: { kind: "openapi", ref: "GET /albums" },
    inputSchema: {
      type: "object",
      properties: { shared: { type: "boolean", description: "Only shared albums" } },
    },
    inputTypeName: "GetAllAlbumsInput",
    httpMethod: "GET",
    pathTemplate: "/albums",
    paramLocations: { path: [], query: ["shared"], body: [] },
    serverUrl: "https://photos.example.com/api",
    sideEffect: "read",
    endpointRole: "endpoint",
    enabledByDefault: true,
    withheld: false,
    requiresAuth: false,
    description: "List all albums",
    descriptionSource: "openapi-summary",
    riskTier: "safe-read",
    hints: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      untrustedContentHint: false,
    },
    piiInOutput: [],
    ...overrides,
  };
}

/** The generated file for a tool, named the way the tools output names it. */
function generatedFile(name: string): GeneratedFile {
  return {
    path: `/scratch/src/webmcp/${name}.webmcp.ts`,
    contents: `// ${name}: generated`,
    action: "create",
  };
}

describe("dashboardState", () => {
  it("carries the route facts the run-it test needs", () => {
    const state = dashboardState(
      {
        tools: [reviewedTool()],
        files: [generatedFile("get-all-albums")],
        skipped: [],
        notes: [],
        findings: [],
      },
      { label: "immich.openapi.yaml", outDir: "src/webmcp" },
    );

    expect(state.label).toBe("immich.openapi.yaml");
    expect(state.outDir).toBe("src/webmcp");
    expect(state.tools).toHaveLength(1);
    expect(state.tools[0]!).toMatchObject({
      name: "get-all-albums",
      verb: "GET",
      path: "/albums",
      pathTemplate: "/albums",
      paramLocations: { path: [], query: ["shared"], body: [] },
      serverUrl: "https://photos.example.com/api",
      sideEffect: "read",
      enabled: true,
      withheld: false,
    });
  });

  it("attaches each tool's own generated source, and only its own findings", () => {
    const state = dashboardState(
      {
        tools: [reviewedTool(), reviewedTool({ id: "POST /albums", name: "create-album" })],
        files: [generatedFile("get-all-albums"), generatedFile("create-album")],
        skipped: [{ ref: "POST /webhooks/immich", reason: "webhooks are never tools" }],
        notes: ["stripped the shared v1 prefix"],
        findings: [
          { level: "warning", tool: "create-album", message: "No output schema." },
          { level: "error", message: "Two tools collided." },
        ] satisfies AuditFinding[],
      },
      { label: "immich.openapi.yaml" },
    );

    const [albums, create] = state.tools;

    expect(albums!.source).toEqual({
      fileName: "get-all-albums.webmcp.ts",
      code: "// get-all-albums: generated",
    });
    expect(create!.source?.fileName).toBe("create-album.webmcp.ts");
    // A finding about one tool never shows up on another, and a project-level
    // finding (no tool) belongs to no tool's pane.
    expect(albums!.findings).toEqual([]);
    expect(create!.findings).toEqual([{ level: "warning", message: "No output schema." }]);
    expect(state.skipped).toHaveLength(1);
    expect(state.notes).toEqual(["stripped the shared v1 prefix"]);
  });

  it("shows a developer's saved field text instead of the synthesized line", () => {
    const state = dashboardState(
      {
        tools: [reviewedTool()],
        files: [],
        skipped: [],
        notes: [],
        findings: [],
      },
      {
        label: "immich.openapi.yaml",
        overrides: { "get-all-albums": { fields: { shared: "Only albums shared with me" } } },
      },
    );

    expect(state.tools[0]!.fieldOverrides).toEqual({ shared: "Only albums shared with me" });
  });

  it("marks provenance only where there is something to say", () => {
    const merged = reviewedTool({
      source: { kind: "schema", ref: "create-trip" },
      endpointRef: "POST /v1/trips",
    });
    const schemaOnly = reviewedTool({ source: { kind: "schema", ref: "list-trips" } });

    const state = dashboardState(
      { tools: [merged, schemaOnly], files: [], skipped: [], notes: [], findings: [] },
      { label: "app.schemas.ts" },
    );

    const [mergedTool, schemaTool] = state.tools;

    expect(mergedTool!.provenance).toBe("merged: the create-trip schema and this route");
    expect(mergedTool!.verb).toBe("POST");
    expect(mergedTool!.path).toBe("/v1/trips");
    expect(schemaTool!.provenance).toBe("schema: list-trips");
    expect(schemaTool!.verb).toBeUndefined();
  });
});
