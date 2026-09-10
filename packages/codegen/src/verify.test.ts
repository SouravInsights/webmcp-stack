import { describe, expect, it } from "vitest";
import type { ReviewedTool } from "./types.js";
import { verifyJourneyFiles, verifyTools } from "./verify.js";

function reviewedTool(overrides: Partial<ReviewedTool> = {}): ReviewedTool {
  return {
    id: "GET /orders/{id}",
    name: "get-order-status",
    source: { kind: "openapi", ref: "GET /orders/{id}" },
    inputSchema: {
      type: "object",
      properties: { orderId: { type: "string", description: "The order ID" } },
      required: ["orderId"],
    },
    description: "Returns the current status and tracking info for an order by ID.",
    descriptionSource: "openapi-summary",
    sideEffect: "read",
    enabledByDefault: true,
    withheld: false,
    riskTier: "safe-read",
    hints: { readOnlyHint: true, untrustedContentHint: false },
    ...overrides,
  } as ReviewedTool;
}

describe("verify description budgets", () => {
  it("flags a tool description over the 500-character budget as an error", () => {
    const checks = verifyTools([reviewedTool({ description: `List. ${"word ".repeat(120)}` })]);
    const budgets = checks.find((check) => check.area === "Budgets");
    expect(budgets?.level).toBe("error");
    expect(budgets?.findings[0]).toContain("get-order-status");
    expect(budgets?.findings[0]).toContain("500");
  });

  it("flags a parameter description over the 150-character budget, with its field", () => {
    const checks = verifyTools([
      reviewedTool({
        inputSchema: {
          type: "object",
          properties: { notes: { type: "string", description: `Notes. ${"word ".repeat(40)}` } },
        },
      }),
    ]);
    const budgets = checks.find((check) => check.area === "Budgets");
    expect(budgets?.level).toBe("error");
    expect(budgets?.findings[0]).toContain("get-order-status → notes");
    expect(budgets?.findings[0]).toContain("150");
  });

  it("walks nested fields for the parameter budget", () => {
    const checks = verifyTools([
      reviewedTool({
        inputSchema: {
          type: "object",
          properties: {
            meta: {
              type: "object",
              properties: { remark: { type: "string", description: `R. ${"word ".repeat(40)}` } },
            },
          },
        },
      }),
    ]);
    const budgets = checks.find((check) => check.area === "Budgets");
    expect(budgets?.level).toBe("error");
    expect(budgets?.findings[0]).toContain("remark");
  });

  it("is silent when everything is within budget", () => {
    const checks = verifyTools([reviewedTool()]);
    expect(checks.find((check) => check.area === "Budgets")).toBeUndefined();
  });

  it("flags parameter names over 30 characters as a naming warning", () => {
    const checks = verifyTools([
      reviewedTool({
        inputSchema: {
          type: "object",
          properties: {
            the_unreasonably_long_parameter_name: { type: "string", description: "An id." },
          },
        },
      }),
    ]);
    const names = checks.find((check) => check.area === "Names");
    expect(names?.level).toBe("warning");
    expect(names?.findings[0]).toContain("the_unreasonably_long_parameter_name");
  });
});

describe("verify journey files", () => {
  const goodJourney = `import { createJourney } from "../journey.webmcp";
export const documentTrip = createJourney({
  name: "document-trip",
  goal: "Record a trip you've been on and open the editor to write its story",
  steps: {
    "search-places": {
      description: "Search real places and store the pick.",
      input: { type: "object", properties: { input: { type: "string" } }, required: ["input"] },
      provides: ["locationObject"],
    },
  },
  submit: {
    description: "Create the trip and open it in the editor.",
    build: (draft) => draft,
    run: executeCreateTrip,
  },
});`;

  it("passes a well-formed journey", () => {
    const checks = verifyJourneyFiles([
      { path: "journeys/document-trip.webmcp.ts", contents: goodJourney },
    ]);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.level).toBe("ok");
  });

  it("errors on a journeys file with no createJourney call", () => {
    const checks = verifyJourneyFiles([
      { path: "journeys/random.webmcp.ts", contents: "export const x = 1;" },
    ]);
    expect(checks[0]?.level).toBe("error");
    expect(checks[0]?.findings[0]).toContain("no createJourney() call");
  });

  it("errors on a journey with no submit gate", () => {
    const checks = verifyJourneyFiles([
      {
        path: "journeys/broken.webmcp.ts",
        contents: `createJourney({ name: "x", goal: "y", steps: { "a": { description: "Do a.", input: {}, provides: [] } } });`,
      },
    ]);
    expect(checks.some((check) => check.findings[0]?.includes("no submit gate"))).toBe(true);
  });

  it("errors on over-budget descriptions", () => {
    const checks = verifyJourneyFiles([
      {
        path: "journeys/wordy.webmcp.ts",
        contents: goodJourney.replace(
          "Search real places and store the pick.",
          `Search. ${"So very much detail about searching. ".repeat(15)}`,
        ),
      },
    ]);
    const budget = checks.find(
      (check) => check.level === "error" && check.summary.includes("budget"),
    );
    expect(budget?.findings[0]).toContain("500");
  });

  it("warns on more than five steps", () => {
    const steps = Array.from(
      { length: 6 },
      (_, i) =>
        `"step-${i}": { description: "Do thing ${i}.", input: { type: "object" }, provides: ["f${i}"] },`,
    ).join("\n    ");
    const checks = verifyJourneyFiles([
      {
        path: "journeys/epic.webmcp.ts",
        contents: `createJourney({ name: "epic", goal: "g", steps: {\n    ${steps}\n  }, submit: { description: "Go.", build: (d) => d, run: x } });`,
      },
    ]);
    const warning = checks.find((check) => check.level === "warning");
    expect(warning?.findings[0]).toContain("6 steps");
  });

  it("warns when a journey calls fetch directly", () => {
    const checks = verifyJourneyFiles([
      {
        path: "journeys/raw.webmcp.ts",
        contents: goodJourney.replace(
          'provides: ["locationObject"],',
          'provides: ["locationObject"],\n      run: async (input) => { const r = await fetch("/v1/places"); return { locationObject: r }; },',
        ),
      },
    ]);
    const warning = checks.find((check) => check.level === "warning");
    expect(warning?.findings[0]).toContain("fetch/callApi directly");
  });
});
