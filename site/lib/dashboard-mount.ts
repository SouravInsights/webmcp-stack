"use client";

import { type DashboardMode, dashboardHtml, type UiState } from "@webmcp-stack/codegen/dev";

/**
 * Mounting the real dashboard UI in a shadow root.
 *
 * The dashboard is a single HTML string (packages/codegen/src/dev/ui.ts) and
 * its own script boots from injected state. Both the landing demo and the
 * playground mount it this way, so what visitors see is the product itself,
 * never a re-implementation of it.
 *
 * Two things the UI's script expects that a shadow root does not give it:
 *
 *   document.getElementById / querySelector   the UI is written for a whole
 *                                             document, so lookups fall
 *                                             through to the mounted root
 *   fetch                                     the playground answers
 *                                             /api/state, /api/override and
 *                                             /api/run in the page itself
 */

export type BridgeFetch = (path: string, init?: RequestInit) => Promise<Response>;

/** Where the bridge function waits while the UI's script starts up. */
const BRIDGE_KEY = "__webmcpDashboardBridge";

const roots: ShadowRoot[] = [];
/** The state each root is currently showing, so a re-mount is deliberate. */
const mounted = new WeakMap<ShadowRoot, UiState>();
let patched = false;

/**
 * Teach the document's lookup methods about mounted dashboard roots. Installed
 * once per page, and only when a dashboard is actually mounted.
 */
function installDocumentLookup(): void {
  if (patched) return;
  patched = true;

  const byId = document.getElementById.bind(document);
  const query = document.querySelector.bind(document);
  const queryAll = document.querySelectorAll.bind(document);

  document.getElementById = (id: string) =>
    byId(id) ?? firstRoot((root) => root.getElementById(id));

  document.querySelector = ((selectors: string) =>
    query(selectors) ??
    firstRoot((root) => root.querySelector(selectors))) as typeof document.querySelector;

  // The UI asks for the test form's fields by attribute. A NodeList cannot be
  // concatenated, so the light DOM wins when it has matches (it never does for
  // dashboard selectors) and the first live root with matches is returned
  // otherwise.
  document.querySelectorAll = ((selectors: string) => {
    const found = queryAll(selectors);
    if (found.length > 0) return found;
    for (const root of roots) {
      if (!root.host.isConnected) continue;
      const inRoot = root.querySelectorAll(selectors);
      if (inRoot.length > 0) return inRoot;
    }
    return found;
  }) as typeof document.querySelectorAll;
}

/**
 * The first mounted root that still holds the thing being looked for. A root
 * whose host left the document is skipped: React unmounts a page's dashboard
 * on navigation, and a stale root must not answer the next page's lookups.
 */
function firstRoot<T>(find: (root: ShadowRoot) => T | null): T | null {
  for (const root of roots) {
    if (!root.host.isConnected) continue;
    const found = find(root);
    if (found) return found;
  }
  return null;
}

export interface MountDashboardOptions {
  /** Which host is rendering, so the UI's copy matches where it runs. */
  mode?: DashboardMode;
  /**
   * Answer the dashboard's three requests from the page instead of a server:
   * the hosted playground has no dev server behind it.
   */
  bridge?: BridgeFetch;
}

/**
 * Render the dashboard for `state` inside `host`, replacing anything already
 * mounted there. Call it again with new state (the playground does, when a
 * second spec is generated).
 */
export function mountDashboard(
  host: HTMLElement,
  state: UiState,
  options: MountDashboardOptions = {},
): void {
  installDocumentLookup();

  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  if (!roots.includes(root)) roots.push(root);
  // React runs effects twice in development. Mounting the same state twice
  // would leave the first copy's document-level key handlers listening, so
  // only a new state mounts again (the playground, on a second spec).
  if (mounted.get(root) === state) return;
  mounted.set(root, state);
  root.replaceChildren();

  // Scripts inserted by innerHTML or DOMParser never execute (spec-level,
  // shadow roots included). Adopt the styles and markup, then re-create the
  // script element so the dashboard's JS actually runs.
  const doc = new DOMParser().parseFromString(
    dashboardHtml(state, { scoped: true, mode: options.mode }),
    "text/html",
  );
  for (const node of Array.from(doc.querySelectorAll("style"))) {
    root.appendChild(document.importNode(node, true));
  }
  for (const node of Array.from(doc.body.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === "SCRIPT") continue;
    root.appendChild(document.importNode(node, true));
  }

  const script = doc.querySelector("script");
  if (!script?.textContent) return;

  // A bridge has to reach the UI's script as a local `fetch`: the wrapper
  // below gives it a scope of its own, so the page's own fetch stays real.
  const bridgeDecl = options.bridge ? `var fetch = window[${JSON.stringify(BRIDGE_KEY)}];` : "";
  const live = document.createElement("script");
  live.textContent = `(function () {\n${bridgeDecl}\n${script.textContent}\n})();`;

  const target = window as unknown as Record<string, unknown>;
  if (options.bridge) target[BRIDGE_KEY] = options.bridge;
  try {
    // Appending runs the script synchronously, so the bridge can go away here.
    root.appendChild(live);
  } finally {
    delete target[BRIDGE_KEY];
  }
}
