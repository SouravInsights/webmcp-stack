/**
 * Turning a tool plus typed input into the HTTP request that tool makes.
 *
 * The dev server uses this to run a tool server-side; the hosted playground
 * uses the same function in the visitor's browser. One function, so a tool
 * tested in the playground makes the request the CLI's generated code makes.
 *
 * Nothing here touches the filesystem or the network, so a browser bundle
 * can import it.
 */

/** The route facts a request needs. Every tool the dashboard shows carries them. */
export interface ToolRoute {
  /** "GET", "POST", ... as the dashboard shows it. */
  verb?: string;
  pathTemplate?: string;
  paramLocations?: { path: string[]; query: string[]; body: string[] };
  serverUrl?: string;
}

export interface ToolRequest {
  method: string;
  /** Absolute URL, path params filled in and query params set. */
  url: string;
  /** Present only when the tool has body fields. */
  body?: unknown;
}

export type ToolRequestResult = { request: ToolRequest } | { error: string };

/**
 * Build the request for one tool call. `baseUrl` overrides the spec's server,
 * which is what the dashboard's base URL field is for: the spec often lists a
 * production host, while the developer wants to test against localhost.
 */
export function buildToolRequest(
  route: ToolRoute,
  input: Record<string, unknown>,
  baseUrl?: string,
): ToolRequestResult {
  const base = (baseUrl || route.serverUrl || "").replace(/\/+$/, "");
  if (!base) {
    return {
      error:
        "No base URL: the spec lists no absolute server. Type your app's URL " +
        '(e.g. http://localhost:3000) in the "base URL" field and run again.',
    };
  }
  if (!route.pathTemplate || !route.verb) {
    return { error: "This tool has no route to call." };
  }

  let path = route.pathTemplate;
  for (const param of route.paramLocations?.path ?? []) {
    path = path.replace(`{${param}}`, encodeURIComponent(String(input[param] ?? "")));
  }
  if (!path.startsWith("/")) path = `/${path}`;

  // Concatenated, not resolved against the base: a spec server carries its
  // base path ("https://api.example.com/v1"), and resolving "/pets" against
  // it would drop the "/v1". The generated code concatenates for the same
  // reason, so the test call and the shipped tool hit the same URL.
  let url: URL;
  try {
    url = new URL(`${base}${path}`);
  } catch {
    return { error: `"${base}" is not a URL. Fix the base URL field and run again.` };
  }

  for (const param of route.paramLocations?.query ?? []) {
    const value = input[param];
    if (value !== undefined && value !== null) url.searchParams.set(param, String(value));
  }

  const bodyFields = route.paramLocations?.body ?? [];
  const body =
    bodyFields.length === 1 && bodyFields[0] === "body"
      ? input.body
      : bodyFields.length > 0
        ? Object.fromEntries(bodyFields.map((field) => [field, input[field]]))
        : undefined;

  return {
    request: {
      method: route.verb,
      url: url.toString(),
      ...(body !== undefined ? { body } : {}),
    },
  };
}
