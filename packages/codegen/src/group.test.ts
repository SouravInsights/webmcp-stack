import { describe, expect, it } from "vitest";
import { groupHandshakes } from "./group.js";
import { generatedRegion } from "./outputs/tools-templates.js";
import type { CandidateTool, ReviewedTool } from "./types.js";

function post(
  overrides: Partial<CandidateTool> & { name: string; pathTemplate: string },
): CandidateTool {
  return {
    id: `POST ${overrides.pathTemplate}`,
    source: { kind: "openapi", ref: `POST ${overrides.pathTemplate}` },
    inputSchema: { type: "object", properties: {} },
    inputTypeName: "Input",
    httpMethod: "POST",
    paramLocations: { path: [], query: [], body: [] },
    sideEffect: "write",
    requiresAuth: false,
    description: "Does a thing.",
    descriptionSource: "openapi-summary",
    ...overrides,
  };
}

/** The beenthere upload handshake, faithfully. */
function uploadPair(): CandidateTool[] {
  return [
    post({
      name: "create-media-request-upload",
      pathTemplate: "/v1/media/request-upload",
      paramLocations: { path: [], query: [], body: ["fileName"] },
      inputSchema: {
        type: "object",
        properties: { fileName: { type: "string", description: "The file's name." } },
        required: ["fileName"],
      },
      outputSchema: {
        type: "object",
        properties: { uploadId: { type: "string" }, url: { type: "string" } },
      },
    }),
    post({
      name: "complete-media-upload",
      pathTemplate: "/v1/media/uploads/{uploadId}/complete",
      paramLocations: { path: ["uploadId"], query: [], body: [] },
      inputSchema: {
        type: "object",
        properties: { uploadId: { type: "string", description: "The upload to complete." } },
        required: ["uploadId"],
      },
      outputSchema: { type: "object", properties: { media: { type: "object" } } },
    }),
  ];
}

describe("groupHandshakes", () => {
  it("merges a request/complete pair into one withheld, thread-wired proposal", () => {
    const { tools, notes } = groupHandshakes(uploadPair());

    // Members stay; the merged tool is appended.
    expect(tools).toHaveLength(3);
    const merged = tools.find((tool) => tool.name === "upload-media");
    expect(merged).toBeDefined();
    expect(merged?.compose?.threaded).toEqual({ uploadId: "uploadId" });

    // The merged input drops the threaded field, keeps the real input.
    expect(Object.keys(merged?.inputSchema.properties ?? {})).toEqual(["fileName"]);
    expect(merged?.inputSchema.required).toEqual(["fileName"]);

    // The result is the SECOND call's response.
    expect(merged?.outputSchema?.properties).toHaveProperty("media");

    // The report names the proposal and how to adopt it.
    expect(notes[0]).toContain(
      "Grouped create-media-request-upload + complete-media-upload into upload-media",
    );
    expect(notes[0]).toContain("starts withheld");
  });

  it("skips the pair when the second call's path param can't be threaded", () => {
    const pair = uploadPair();
    pair[0]!.outputSchema = { type: "object", properties: { token: { type: "string" } } };
    const { tools, notes } = groupHandshakes(pair);
    expect(tools).toHaveLength(2);
    expect(notes[0]).toContain("path params the first response doesn't provide");
  });

  it("does not pair across different resources", () => {
    const pair = uploadPair();
    pair[1]!.pathTemplate = "/v1/videos/uploads/{uploadId}/complete";
    pair[1]!.name = "complete-videos-upload";
    const { tools } = groupHandshakes(pair);
    expect(tools).toHaveLength(2);
  });

  it("does not pair GETs or lone POSTs", () => {
    const readsOnly = [post({ name: "request-data-export", pathTemplate: "/v1/data/request" })];
    expect(groupHandshakes(readsOnly).tools).toHaveLength(1);

    const getPair = uploadPair().map((tool) => ({ ...tool, httpMethod: "GET" as const }));
    expect(groupHandshakes(getPair).tools).toHaveLength(2);
  });

  it("falls back to a free name when the natural one is taken", () => {
    const pair = uploadPair();
    const blocker = post({ name: "upload-media", pathTemplate: "/v1/media/other" });
    const { tools } = groupHandshakes([...pair, blocker]);
    const merged = tools.find((tool) => tool.compose);
    expect(merged?.name).not.toBe("upload-media");
    expect(merged?.name).toBeTruthy();
  });
});

describe("composed tool templates", () => {
  it("emits a two-call fetchX that threads the first response into the second call", () => {
    const { tools } = groupHandshakes(uploadPair());
    const merged = tools.find((tool) => tool.compose);
    const region = generatedRegion({
      ...merged,
      enabledByDefault: false,
      withheld: true,
      riskTier: "write-confirm",
      hints: { readOnlyHint: false, untrustedContentHint: false },
      piiInOutput: [],
      endpointRole: "endpoint",
    } as unknown as ReviewedTool);

    expect(region).toContain("export async function fetchUploadMedia(");
    expect(region).toContain('const firstResult = (await callApi("/v1/media/request-upload"');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the emitted template literal, not interpolating in this test.
    expect(region).toContain("${firstResult.uploadId}/complete");
    expect(region).toContain("body: { fileName: input.fileName }");
    // The merged tool is a write: the confirmation gate applies.
    expect(region).toContain("requestUserConfirmation(");
  });
});
