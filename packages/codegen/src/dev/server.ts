/**
 * The dev dashboard server: `npx @webmcp-stack/codegen dev`.
 *
 * A small HTTP server on localhost that serves the tools UI and answers its
 * three kinds of requests: list the tools, save an override (description /
 * enabled) to .webmcp-codegen.json, and run a tool's endpoint for a direct
 * test. It reuses the exact pipeline the CLI runs, so what the dashboard
 * shows is what a generate run would write.
 *
 * It exists only while the command is running, listens on localhost only,
 * and nothing about it ever touches the user's app bundle - by design, so
 * this dev tool can never leak into production.
 */

import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { loadDataFile, saveDataFile } from "../data-file.js";
import { runGenerate } from "../pipeline.js";
import { resolveSetup } from "../setup.js";
import { buildToolRequest } from "./request.js";
import { dashboardState, type UiState, type UiTool } from "./state.js";
import { dashboardHtml } from "./ui.js";

export interface DevServerOptions {
  cwd: string;
  port: number;
  /** Open the browser automatically. False in tests and CI. */
  open?: boolean;
}

interface RunRequest {
  name: string;
  input: Record<string, unknown>;
  /** Absolute base URL when the API is not same-origin with the dashboard. */
  baseUrl?: string;
}

export async function startDevServer(options: DevServerOptions): Promise<Server> {
  const setup = await resolveSetup(options.cwd, {
    dryRun: true,
    skipAudit: false,
    force: false,
    watch: false,
  });

  /** Re-run the pipeline fresh on every state request: edits to the spec
   *  show up on reload without restarting the dashboard. */
  async function currentState(): Promise<UiState> {
    const data = await loadDataFile(options.cwd);
    const result = await runGenerate(setup.config, {
      cwd: options.cwd,
      dryRun: true,
      overrides: data.overrides,
      // So the dashboard shows a rename the next CLI run would make, and its
      // edits follow the renamed tool instead of vanishing from the UI.
      previousNames: data.names,
    });
    return dashboardState(result, {
      label: setup.label,
      outDir: setup.config.outputs[0]?.outDir,
      overrides: data.overrides,
    });
  }

  const server = createServer(async (request, response) => {
    try {
      await route(request, response);
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  async function route(
    request: import("node:http").IncomingMessage,
    response: import("node:http").ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(dashboardHtml());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/state") {
      sendJson(response, 200, await currentState());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/override") {
      const body = (await readJson(request)) as {
        name?: string;
        description?: string;
        enabled?: boolean;
        fields?: Record<string, string>;
      };
      if (!body.name) {
        sendJson(response, 400, { error: "Missing tool name." });
        return;
      }
      const data = await loadDataFile(options.cwd);
      const overrides = { ...(data.overrides ?? {}) };
      const existing = overrides[body.name] ?? {};
      // Explicit fields win over what's stored; undefined means "untouched".
      overrides[body.name] = {
        ...existing,
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        // Per-field text merges key by key, so editing one field never drops
        // the developer's edits to another.
        ...(body.fields !== undefined
          ? { fields: { ...(existing.fields ?? {}), ...body.fields } }
          : {}),
      };
      await saveDataFile(options.cwd, { overrides });
      sendJson(response, 200, { ok: true, saved: `.webmcp-codegen.json` });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/run") {
      const body = (await readJson(request)) as RunRequest;
      const state = await currentState();
      const tool = state.tools.find((candidate) => candidate.name === body.name);
      if (!tool) {
        sendJson(response, 404, { error: `No tool named "${body.name}".` });
        return;
      }
      const result = await runEndpoint(tool, body.input ?? {}, body.baseUrl);
      sendJson(response, result.ok ? 200 : 502, result);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  }

  await new Promise<void>((resolveListen) =>
    server.listen(options.port, "127.0.0.1", resolveListen),
  );

  if (options.open !== false) openBrowser(`http://localhost:${options.port}`);
  return server;
}

/**
 * The direct "run it" test: call the endpoint the way the generated
 * execute() would, but server-side. Two honest limitations the UI states:
 * there is no browser session here (auth cookies do not apply), and the
 * call needs an absolute base URL - the spec's servers entry or one the
 * developer types in.
 *
 * The request itself is built by buildToolRequest, the same function the
 * site's playground runs in the visitor's browser.
 */
async function runEndpoint(
  tool: UiTool,
  input: Record<string, unknown>,
  baseUrlOverride?: string,
): Promise<{ ok: boolean; status?: number; body?: unknown; error?: string }> {
  const built = buildToolRequest(tool, input, baseUrlOverride);
  if ("error" in built) return { ok: false, error: built.error };
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
    return { ok: response.ok, status: response.status, body: parsed };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function sendJson(
  response: import("node:http").ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json",
  });
  response.end(JSON.stringify(body));
}

function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolveRead, reject) => {
    let text = "";
    request.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8");
    });
    request.on("end", () => {
      try {
        resolveRead(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(command, [url], { stdio: "ignore", shell: process.platform === "win32" }).unref();
}
