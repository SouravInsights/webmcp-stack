import ts from "typescript";
import { describe, expect, it } from "vitest";
import type { ReviewedTool } from "../types.js";
import {
  barrelSource,
  generatedRegion,
  ownedRegionScaffold,
  runtimeSource,
} from "./tools-templates.js";

/**
 * These tests exist because the templates are TypeScript built from template
 * literals, and an escape that is correct in the source file can be wrong in
 * the emitted file. The 1.5K truncation notice shipped as a string literal
 * broken across two lines exactly this way: the source had "\n", the outer
 * template literal turned it into a real newline, and every generated
 * runtime.webmcp.ts was a syntax error. Parsing the output is the only check
 * that catches that class of mistake.
 */

/** A reviewed tool with every field the templates read, overridable. */
function reviewedTool(overrides: Partial<ReviewedTool> = {}): ReviewedTool {
  return {
    id: "GET /orders/{id}",
    name: "get-order-status",
    source: { kind: "openapi", ref: "GET /orders/{id}" },
    inputSchema: {
      type: "object",
      properties: { orderId: { type: "string", description: "The order ID." } },
      required: ["orderId"],
    },
    outputSchema: { type: "object", properties: { status: { type: "string" } } },
    inputTypeName: "GetOrderStatusInput",
    httpMethod: "GET",
    pathTemplate: "/orders/{orderId}",
    paramLocations: { path: ["orderId"], query: [], body: [] },
    sideEffect: "read",
    endpointRole: "endpoint",
    requiresAuth: false,
    enabledByDefault: true,
    withheld: false,
    description: "Returns the current status of an order.",
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
  } as ReviewedTool;
}

/** Syntactic diagnostics only: we do not resolve the runtime import. */
function syntaxErrors(source: string): string[] {
  const result = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return (result.diagnostics ?? []).map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
  );
}

describe("generated files parse", () => {
  it("runtime.webmcp.ts is valid syntax and keeps the truncation escape", () => {
    const runtime = runtimeSource();
    expect(syntaxErrors(runtime)).toEqual([]);
    // A real newline inside this double-quoted string is the bug we shipped
    // once; the emitted file must carry the two-character escape instead.
    expect(runtime).toContain('"\\n');
  });

  it("an enabled endpoint tool parses", () => {
    const tool = reviewedTool();
    expect(syntaxErrors(`${generatedRegion(tool)}${ownedRegionScaffold(tool)}`)).toEqual([]);
  });

  it("a withheld write tool parses, comments and all", () => {
    const tool = reviewedTool({
      name: "create-trip",
      id: "POST /trips",
      source: { kind: "openapi", ref: "POST /trips" },
      httpMethod: "POST",
      pathTemplate: "/trips",
      paramLocations: { path: [], query: [], body: ["title"] },
      inputSchema: { type: "object", properties: { title: { type: "string" } } },
      sideEffect: "write",
      riskTier: "write-confirm",
      enabledByDefault: false,
      withheld: true,
      hints: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        untrustedContentHint: false,
      },
    });
    expect(syntaxErrors(`${generatedRegion(tool)}${ownedRegionScaffold(tool)}`)).toEqual([]);
  });

  it("the barrel parses, with and without journeys", () => {
    expect(syntaxErrors(barrelSource([reviewedTool()]))).toEqual([]);
    expect(syntaxErrors(barrelSource([reviewedTool()], ["document-trip.webmcp.ts"]))).toEqual([]);
  });

  it("a composed handshake tool parses", () => {
    const tool = reviewedTool({
      name: "upload-media",
      id: "POST /media/request-upload + POST /media/uploads/{uploadId}/complete",
      source: {
        kind: "openapi",
        ref: "POST /media/request-upload + POST /media/uploads/{uploadId}/complete",
      },
      httpMethod: undefined,
      pathTemplate: undefined,
      paramLocations: undefined,
      inputSchema: {
        type: "object",
        properties: { fileName: { type: "string" } },
        required: ["fileName"],
      },
      sideEffect: "write",
      riskTier: "write-confirm",
      enabledByDefault: false,
      withheld: true,
      compose: {
        first: {
          httpMethod: "POST",
          pathTemplate: "/media/request-upload",
          paramLocations: { path: [], query: [], body: ["fileName"] },
        },
        second: {
          httpMethod: "POST",
          pathTemplate: "/media/uploads/{uploadId}/complete",
          paramLocations: { path: ["uploadId"], query: [], body: [] },
        },
        threaded: { uploadId: "uploadId" },
      },
    });
    expect(syntaxErrors(`${generatedRegion(tool)}${ownedRegionScaffold(tool)}`)).toEqual([]);
  });
});
