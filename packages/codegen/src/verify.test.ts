import { describe, expect, it } from "vitest";
import type { ReviewedTool } from "./types.js";
import { verifyTools } from "./verify.js";

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
