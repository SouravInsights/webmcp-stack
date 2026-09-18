import type { UiState } from "@webmcp-stack/codegen/dev";
import { describe, expect, it, vi } from "vitest";
import { createPlaygroundBridge, labelForUrl, withResolvedServers } from "./playground";

/** The Petstore shape: a relative server URL and a path parameter. */
function petstoreState(serverUrl: string | null = "/api/v3"): UiState {
  return {
    label: "petstore.json",
    outDir: "src/webmcp",
    tools: [
      {
        name: "get-pet-by-id",
        description: "Find pet by ID",
        sideEffect: "read",
        enabled: true,
        endpointRole: "endpoint",
        piiInOutput: [],
        findings: [],
        verb: "GET",
        path: "/pet/{petId}",
        ...(serverUrl ? { serverUrl } : {}),
        pathTemplate: "/pet/{petId}",
        paramLocations: { path: ["petId"], query: [], body: [] },
        inputSchema: { type: "object", properties: { petId: { type: "integer" } } },
      },
    ],
    skipped: [],
    notes: [],
  };
}

describe("withResolvedServers", () => {
  it("resolves a relative server URL against the spec's own URL", () => {
    const state = withResolvedServers(
      petstoreState(),
      "https://petstore3.swagger.io/api/v3/openapi.json",
    );
    expect(state.tools[0]!.serverUrl).toBe("https://petstore3.swagger.io/api/v3");
  });

  it("leaves a pasted spec's relative server URL for the visitor to fill in", () => {
    const state = withResolvedServers(petstoreState(), null);
    expect(state.tools[0]!.serverUrl).toBe("/api/v3");
  });

  it("does not touch an absolute server URL", () => {
    const state = withResolvedServers(
      petstoreState("https://api.example.com/v1"),
      "https://petstore3.swagger.io/api/v3/openapi.json",
    );
    expect(state.tools[0]!.serverUrl).toBe("https://api.example.com/v1");
  });
});

describe("createPlaygroundBridge", () => {
  it("keeps an edit in the tab instead of saving it anywhere", async () => {
    const bridge = createPlaygroundBridge(petstoreState());
    const response = await bridge("/api/override", {
      method: "POST",
      body: JSON.stringify({ name: "get-pet-by-id", enabled: false }),
    });
    expect(await response.json()).toEqual({ ok: true, saved: "this browser tab" });
  });

  it("runs the tool from the page, against the planned request", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      return new Response(JSON.stringify({ id: 7, name: "doggie" }), { status: 200 });
    });

    const bridge = createPlaygroundBridge(petstoreState("https://petstore3.swagger.io/api/v3"));
    const response = await bridge("/api/run", {
      method: "POST",
      body: JSON.stringify({ name: "get-pet-by-id", input: { petId: 7 } }),
    });

    expect(calls).toEqual([{ url: "https://petstore3.swagger.io/api/v3/pet/7", method: "GET" }]);
    expect(await response.json()).toEqual({
      ok: true,
      status: 200,
      body: { id: 7, name: "doggie" },
    });
    vi.unstubAllGlobals();
  });

  it("says what to fix when the spec lists no server", async () => {
    const bridge = createPlaygroundBridge(petstoreState(null));
    const response = await bridge("/api/run", {
      method: "POST",
      body: JSON.stringify({ name: "get-pet-by-id", input: {} }),
    });
    const payload = (await response.json()) as { ok: boolean; error: string };
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("No base URL");
  });

  it("explains an unreachable API instead of showing a bare network error", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });

    const bridge = createPlaygroundBridge(petstoreState("https://api.example.com"));
    const response = await bridge("/api/run", {
      method: "POST",
      body: JSON.stringify({ name: "get-pet-by-id", input: { petId: 7 } }),
    });
    const payload = (await response.json()) as { ok: boolean; error: string };
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("GET https://api.example.com/pet/7");
    expect(payload.error).toContain("CORS");
    vi.unstubAllGlobals();
  });
});

describe("labelForUrl", () => {
  it("names the sidebar after the file the URL points at", () => {
    expect(labelForUrl("https://petstore3.swagger.io/api/v3/openapi.json")).toBe("openapi.json");
    expect(labelForUrl("https://example.com/spec.yaml?v=2")).toBe("spec.yaml");
    expect(labelForUrl("https://example.com/")).toBe("spec");
  });
});
