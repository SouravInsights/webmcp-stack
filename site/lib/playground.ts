"use client";

import { buildToolRequest, type UiState } from "@webmcp-stack/codegen/dev";
import type { BridgeFetch } from "@/lib/dashboard-mount";

/**
 * The playground's client half: get a spec, ask the server to run the real
 * codegen pipeline over it, and answer the dashboard's requests in the page.
 *
 * Two deliberate choices here:
 *
 *   The spec is read by the browser, never fetched by our server. A demo that
 *   fetched any URL a visitor typed would be an open proxy into whatever
 *   network the site runs in. CORS rules decide what a browser may read, which
 *   is the honest limit, and the error says so.
 *
 *   Tool calls go out from the browser too. The visitor's own network and
 *   session are what the tool is meant to use, and we never see the traffic.
 */

export interface PlaygroundResult {
  state: UiState;
  /** Audit errors: in a repo these stop generation. The playground shows them. */
  errors: number;
  warnings: number;
}

/** Examples the page offers. Fetched by the browser, same as a typed URL. */
export const EXAMPLES: Array<{ label: string; url: string; note: string }> = [
  {
    label: "Petstore",
    url: "https://petstore3.swagger.io/api/v3/openapi.json",
    note: "the classic OpenAPI example, and its API allows browser calls",
  },
  {
    label: "Immich (excerpt)",
    url: "/demo/immich-excerpt.openapi.yaml",
    note: "real photo-app endpoints, trimmed for reading",
  },
];

/** Roughly 2 MB of spec. The route enforces the same ceiling. */
export const MAX_SPEC_CHARS = 2_000_000;

export async function generateTools(spec: string, label: string): Promise<PlaygroundResult> {
  const response = await fetch("/api/playground", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ spec, label }),
  });
  const payload = (await response.json().catch(() => null)) as
    | (PlaygroundResult & { error?: string })
    | null;
  if (!response.ok || !payload?.state) {
    throw new Error(payload?.error ?? `Could not generate tools (HTTP ${response.status}).`);
  }
  return payload;
}

export async function readSpecFile(file: File): Promise<string> {
  const text = await file.text();
  if (!text.trim()) throw new Error(`${file.name} is empty.`);
  return text;
}

/** Fetch a spec the visitor pointed at. The browser does this, not our server. */
export async function loadSpecFromUrl(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(
      `Could not read ${url} from this page. Most likely that host does not allow ` +
        "browser requests (CORS). Download the spec and paste or upload it instead.",
    );
  }
  if (!response.ok) {
    throw new Error(`${url} answered HTTP ${response.status}. Check the link.`);
  }
  const text = await response.text();
  if (!text.trim()) throw new Error(`${url} is empty.`);
  return text;
}

/** The file name a spec URL ends with, for the sidebar label. */
export function labelForUrl(url: string): string {
  try {
    const { pathname } = new URL(url);
    return pathname.split("/").filter(Boolean).pop() ?? "spec";
  } catch {
    return url.split("/").filter(Boolean).pop() ?? "spec";
  }
}

/**
 * Resolve a spec's relative server URLs against the document's own URL.
 *
 * OpenAPI allows `servers[].url` to be relative (the Petstore spec ships
 * `"/api/v3"`), and the spec says such a URL is relative to the document's
 * location. The run form needs an absolute base, so a spec loaded from a URL
 * gets one. A pasted spec has no location, and the field stays empty for the
 * visitor to fill in.
 */
export function withResolvedServers(state: UiState, specUrl: string | null): UiState {
  if (!specUrl) return state;
  let documentUrl: URL;
  try {
    documentUrl = new URL(specUrl);
  } catch {
    return state;
  }
  for (const tool of state.tools) {
    if (!tool.serverUrl || isAbsoluteUrl(tool.serverUrl)) continue;
    try {
      // Against the document's own URL, which is what OpenAPI says a relative
      // server URL is relative to.
      tool.serverUrl = new URL(tool.serverUrl, documentUrl).toString().replace(/\/+$/, "");
    } catch {
      // Leave it alone: the run form's own message explains what to fix.
    }
  }
  return state;
}

function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Answer the dashboard's three requests inside the page. The dev server
 * serves these from Node; the hosted playground has no server state, so
 * edits live in the tab and tool calls leave from the browser.
 */
export function createPlaygroundBridge(state: UiState): BridgeFetch {
  return async (path, init) => {
    if (path.endsWith("/api/state")) return json(state);

    // An edit here changes the tab only. The dashboard updates its own copy
    // after this resolves, so the change is visible immediately.
    if (path.endsWith("/api/override")) return json({ ok: true, saved: "this browser tab" });

    if (path.endsWith("/api/run")) {
      const request = parseRunBody(init?.body);
      const tool = state.tools.find((candidate) => candidate.name === request.name);
      if (!tool) return json({ ok: false, error: `No tool named "${request.name}".` });

      const built = buildToolRequest(tool, request.input, request.baseUrl);
      if ("error" in built) return json({ ok: false, error: built.error });
      const { method, url, body } = built.request;

      try {
        const response = await fetch(url, {
          method,
          headers: body !== undefined ? { "content-type": "application/json" } : undefined,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = await response.text();
        let parsed: unknown = text;
        try {
          parsed = JSON.parse(text);
        } catch {
          // Plain-text response; keep it as text.
        }
        return json({ ok: response.ok, status: response.status, body: parsed });
      } catch {
        return json({ ok: false, error: unreachable(method, url) });
      }
    }

    return json({ ok: false, error: `The playground has no handler for ${path}.` });
  };
}

function parseRunBody(body: BodyInit | null | undefined): {
  name: string;
  input: Record<string, unknown>;
  baseUrl?: string;
} {
  if (typeof body !== "string") return { name: "", input: {} };
  try {
    return JSON.parse(body) as { name: string; input: Record<string, unknown>; baseUrl?: string };
  } catch {
    return { name: "", input: {} };
  }
}

function unreachable(method: string, url: string): string {
  return (
    `${method} ${url}\n\n` +
    "This page could not reach the API. The usual reason is that the API does not " +
    "allow browser requests from another origin (CORS); the other is that the host " +
    "is not reachable from here. Your generated tool calls this API from your app's " +
    "own origin, where neither applies."
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
