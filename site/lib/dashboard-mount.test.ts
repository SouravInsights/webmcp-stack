import type { UiState } from "@webmcp-stack/codegen/dev";
import { afterEach, describe, expect, it } from "vitest";
import { type BridgeFetch, mountDashboard } from "./dashboard-mount";

/**
 * What these tests protect: the dashboard is the product, mounted as a string
 * of HTML into a shadow root, and both the landing demo and the playground
 * depend on it booting from injected state. If the UI's script ever stops
 * finding the document's nodes through a shadow root, or the page-side bridge
 * stops answering its requests, that is what breaks here.
 */

function tool(name: string): UiState["tools"][number] {
  return {
    name,
    description: "List all albums",
    sideEffect: "read",
    enabled: true,
    endpointRole: "endpoint",
    piiInOutput: [],
    findings: [],
    verb: "GET",
    path: "/albums",
    serverUrl: "https://api.example.com",
    pathTemplate: "/albums",
    paramLocations: { path: [], query: [], body: [] },
    inputSchema: { type: "object", properties: { shared: { type: "boolean" } } },
    source: { fileName: `${name}.webmcp.ts`, code: "// generated" },
  };
}

function state(...names: string[]): UiState {
  return {
    label: "spec.yaml",
    outDir: "src/webmcp",
    tools: names.map(tool),
    skipped: [],
    notes: [],
  };
}

/**
 * happy-dom does not evaluate a script appended at runtime, so the dashboard's
 * own script is run here the way a browser runs it on append. The bridge
 * function has to be reachable under the same key the mount wrote it to, since
 * the mount clears it as soon as the browser would have finished appending.
 */
function boot(host: HTMLElement, bridge?: BridgeFetch): void {
  const text = host.shadowRoot?.querySelector("script")?.textContent ?? "";
  expect(text).not.toBe("");
  if (bridge) (window as unknown as Record<string, unknown>).__webmcpDashboardBridge = bridge;
  // biome-ignore lint/security/noGlobalEval: running the dashboard's script as the browser would
  eval(text);
}

describe("mountDashboard", () => {
  // One dashboard per document is the contract, so each test starts from an
  // empty body: a removed host stops answering the document's lookups.
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("boots the dashboard against the shadow root, with the playground's copy", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mountDashboard(host, state("get-all-albums"), { mode: "playground" });
    boot(host);

    const root = host.shadowRoot;
    expect(root?.querySelector(".tool-name")?.textContent).toBe("get-all-albums");
    // The mode decides the copy. Assert on the rendered pane, not the markup:
    // the script's own source carries both branches of every such line.
    root?.querySelector(".tool")?.dispatchEvent(new Event("click"));
    expect(root?.querySelector(".try-note")?.textContent).toBe(
      "from this page, your session applies",
    );
  });

  it("answers the run form through the page bridge", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const calls: string[] = [];
    const bridge: BridgeFetch = async (path) => {
      calls.push(path);
      return new Response(JSON.stringify({ ok: false, error: "no base URL" }), { status: 200 });
    };
    mountDashboard(host, state("get-all-albums"), { mode: "playground", bridge });
    boot(host, bridge);

    const root = host.shadowRoot;
    // Selecting the tool renders the detail pane, which carries the run form.
    root?.querySelector(".tool")?.dispatchEvent(new Event("click"));
    const runButton = root?.querySelector("#run");
    expect(runButton).toBeTruthy();
    runButton?.dispatchEvent(new Event("click"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toContain("/api/run");
    // The bridge's answer reaches the result pane as written, not as an HTTP error.
    expect(root?.querySelector("#result")?.textContent).toContain("no base URL");
  });

  it("replaces the mounted tools when a second spec lands", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mountDashboard(host, state("get-all-albums"), { mode: "playground" });
    boot(host);

    mountDashboard(host, state("create-album"), { mode: "playground" });
    boot(host);

    const names = Array.from(host.shadowRoot?.querySelectorAll(".tool-name") ?? []).map(
      (node) => node.textContent,
    );
    expect(names).toEqual(["create-album"]);
  });
});
