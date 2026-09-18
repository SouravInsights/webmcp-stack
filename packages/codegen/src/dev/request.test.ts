import { describe, expect, it } from "vitest";
import { buildToolRequest } from "./request.js";

describe("buildToolRequest", () => {
  it("fills path params and sets query params", () => {
    const built = buildToolRequest(
      {
        verb: "GET",
        pathTemplate: "/pets/{petId}/photos",
        paramLocations: { path: ["petId"], query: ["limit"], body: [] },
        serverUrl: "https://api.example.com/v1",
      },
      { petId: "7", limit: 5 },
    );

    expect(built).toEqual({
      request: {
        method: "GET",
        url: "https://api.example.com/v1/pets/7/photos?limit=5",
      },
    });
  });

  it("keeps the base path a spec's server URL carries", () => {
    // The Petstore shape: servers[0] ends in /api/v3 and every path is
    // relative to it. Resolving "/pet/7" against the base would drop the
    // prefix and 404, so the base is concatenated, exactly as the generated
    // callApi(...) does.
    const built = buildToolRequest(
      {
        verb: "GET",
        pathTemplate: "/pet/{petId}",
        paramLocations: { path: ["petId"], query: [], body: [] },
        serverUrl: "https://petstore3.swagger.io/api/v3",
      },
      { petId: "7" },
    );

    expect("request" in built && built.request.url).toBe(
      "https://petstore3.swagger.io/api/v3/pet/7",
    );
  });

  it("prefers the typed base URL over the spec's server", () => {
    const built = buildToolRequest(
      {
        verb: "GET",
        pathTemplate: "/albums",
        paramLocations: { path: [], query: [], body: [] },
        serverUrl: "https://production.example.com/api",
      },
      {},
      "http://localhost:3000/api/",
    );

    expect("request" in built && built.request.url).toBe("http://localhost:3000/api/albums");
  });

  it("sends body fields as JSON, and a whole body field as itself", () => {
    const fields = buildToolRequest(
      {
        verb: "POST",
        pathTemplate: "/albums",
        paramLocations: { path: [], query: [], body: ["albumName", "description"] },
        serverUrl: "https://api.example.com",
      },
      { albumName: "Trips", description: "2026" },
    );
    expect("request" in fields && fields.request.body).toEqual({
      albumName: "Trips",
      description: "2026",
    });

    const whole = buildToolRequest(
      {
        verb: "POST",
        pathTemplate: "/search",
        paramLocations: { path: [], query: [], body: ["body"] },
        serverUrl: "https://api.example.com",
      },
      { body: { q: "trips" } },
    );
    expect("request" in whole && whole.request.body).toEqual({ q: "trips" });
  });

  it("leaves an empty input out of the URL rather than sending nulls", () => {
    const built = buildToolRequest(
      {
        verb: "GET",
        pathTemplate: "/albums",
        paramLocations: { path: [], query: ["shared", "limit"], body: [] },
        serverUrl: "https://api.example.com",
      },
      { shared: undefined, limit: null },
    );

    expect("request" in built && built.request.url).toBe("https://api.example.com/albums");
    expect("request" in built && built.request.body).toBeUndefined();
  });

  it("says what to do when the spec lists no absolute server", () => {
    const built = buildToolRequest(
      { verb: "GET", pathTemplate: "/albums", paramLocations: { path: [], query: [], body: [] } },
      {},
    );

    expect(built).toEqual({
      error:
        "No base URL: the spec lists no absolute server. Type your app's URL " +
        '(e.g. http://localhost:3000) in the "base URL" field and run again.',
    });
  });

  it("refuses a tool with no route, and a base URL that is not a URL", () => {
    const noRoute = buildToolRequest({ serverUrl: "https://api.example.com" }, {});
    expect(noRoute).toEqual({ error: "This tool has no route to call." });

    const badBase = buildToolRequest(
      { verb: "GET", pathTemplate: "/albums", paramLocations: { path: [], query: [], body: [] } },
      {},
      "not a url",
    );
    expect("error" in badBase && badBase.error).toContain("is not a URL");
  });
});
