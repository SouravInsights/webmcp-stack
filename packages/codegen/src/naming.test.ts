import { describe, expect, it } from "vitest";
import {
  analyzeRoute,
  cleanOperationId,
  nameFromRoute,
  resolveNames,
  TOOL_NAME_PATTERN,
  toToolName,
} from "./naming.js";

describe("toToolName", () => {
  it("slugifies camelCase operationIds", () => {
    expect(toToolName("getOrderStatus")).toBe("get-order-status");
  });

  it("handles snake_case and SCREAMING_CASE", () => {
    expect(toToolName("list_pets")).toBe("list-pets");
    expect(toToolName("LISTPets")).toBe("list-pets");
  });

  it("strips path syntax", () => {
    expect(toToolName("/orders/{id}/cancel")).toBe("orders-id-cancel");
  });

  it("prefixes names that would start with a digit", () => {
    expect(toToolName("123status")).toBe("tool-123status");
  });

  it("always produces a name the WebMCP runtime accepts", () => {
    const messy = ["getOrderStatus", "/a/{b}/c", "do_thing NOW!", "99 Luftballons", "..."];
    for (const input of messy) {
      expect(toToolName(input)).toMatch(TOOL_NAME_PATTERN);
    }
  });
});

describe("cleanOperationId", () => {
  it("strips framework prefixes", () => {
    expect(cleanOperationId("TripsController_createTrip")).toBe("create-trip");
    expect(cleanOperationId("user.service.getProfile")).toBe("get-profile");
  });

  it("strips trailing version markers", () => {
    expect(cleanOperationId("createTrip_v2")).toBe("create-trip");
    expect(cleanOperationId("getStatus.v3")).toBe("get-status");
  });

  it("leaves plain operationIds alone", () => {
    expect(cleanOperationId("loginOtpVerify")).toBe("login-otp-verify");
  });
});

describe("nameFromRoute", () => {
  it("drops version segments from the fallback concat", () => {
    expect(nameFromRoute("get", "/v1/orders/{id}")).toBe("get-orders-id");
  });
});

describe("analyzeRoute", () => {
  const cases: [string, string, string][] = [
    // Plain REST: the method supplies the verb, the path shape the noun.
    ["post", "/v1/trips", "create-trip"],
    ["get", "/v1/trips", "list-trips"],
    ["get", "/v1/trips/{trip_id}", "get-trip"],
    ["patch", "/v1/trips/{trip_id}", "update-trip"],
    ["delete", "/v1/trips/{trip_id}", "delete-trip"],
    // Nested under a member: the immediate parent joins the base name.
    ["get", "/v1/trips/{trip_id}/blocks", "list-trip-blocks"],
    ["post", "/v1/trips/{trip_id}/template", "create-trip-template"],
    ["get", "/v1/trips/{trip_id}/stamp-eligibility", "get-trip-stamp-eligibility"],
    ["get", "/v1/explore/destinations/{destination_id}/candidates", "list-destination-candidates"],
    // A singular trailing word is a singleton, not a collection.
    ["get", "/v1/auth/session", "get-session"],
    // Action endpoints: the last segment's verb carries the intent.
    ["post", "/v1/trips/{trip_id}/story/generate", "generate-story"],
    // "batch" is a modifier, never the verb: the name says what is written.
    ["post", "/v1/trips/{trip_id}/blocks/batch", "update-blocks-batch"],
    ["post", "/v1/media/batch-delete", "delete-media-batch"],
    // POST on a member path attaches to it: verb "add", parent absorbed.
    ["post", "/v1/bucket-list/destinations/{slug}", "add-bucket-list-destination"],
    ["post", "/v1/bucket-list/destinations/{slug}/trips/{trip_id}", "add-destination-trip"],
    // Auth one-word actions read as verb phrases.
    ["post", "/v1/auth/signup", "sign-up"],
    ["post", "/v1/auth/signin", "sign-in"],
    // A trailing "all" scopes the parent collection.
    ["get", "/v1/pricing/all", "list-all-pricing"],
    ["post", "/v1/auth/verify-otp", "verify-otp"],
    ["post", "/v1/auth/login", "login"],
    ["post", "/v1/search", "search"],
    // "me" means the current member, not a collection.
    ["get", "/v1/users/me", "get-current-user"],
    ["patch", "/v1/users/me", "update-current-user"],
  ];

  it.each(cases)("%s %s -> %s", (method, path, expected) => {
    expect(analyzeRoute(method, path).base).toBe(expected);
  });

  it("marks unmapped methods as fallback tier with an honest concat", () => {
    const analysis = analyzeRoute("head", "/v1/trips/{id}");
    expect(analysis.tier).toBe("fallback");
    expect(analysis.base).toBe("head-trips-id");
  });

  it("every produced name matches the runtime pattern", () => {
    for (const [method, path] of cases.map(([m, p]) => [m, p] as const)) {
      expect(analyzeRoute(method, path).base).toMatch(TOOL_NAME_PATTERN);
    }
  });
});

describe("resolveNames", () => {
  it("deepens colliding route names with parent context, both sides", () => {
    const { names, renames } = resolveNames([
      {
        name: "x",
        declared: false,
        httpMethod: "POST",
        pathTemplate: "/v1/trips/{id}/story/generate",
      },
      {
        name: "y",
        declared: false,
        httpMethod: "POST",
        pathTemplate: "/v1/articles/{id}/story/generate",
      },
    ]);
    expect(names).toEqual(["generate-trip-story", "generate-article-story"]);
    expect(renames).toHaveLength(2);
  });

  it("declared names win collisions; route names deepen around them", () => {
    const { names } = resolveNames([
      { name: "create-trip", declared: true },
      { name: "z", declared: false, httpMethod: "POST", pathTemplate: "/v1/orgs/{id}/trips" },
    ]);
    // The declared "create-trip" keeps the spot; the nested route already
    // carries its parent, so there is no collision at all.
    expect(names).toEqual(["create-trip", "create-org-trip"]);
  });

  it("falls back to a method suffix, then a counter, when context runs out", () => {
    const { names, renames } = resolveNames([
      { name: "a", declared: false, httpMethod: "POST", pathTemplate: "/v1/search" },
      { name: "b", declared: false, httpMethod: "POST", pathTemplate: "/v1/search" },
    ]);
    expect(names[0]).toBe("search");
    expect(names[1]).toBe("search-post");
    expect(renames).toHaveLength(1);
  });

  it("notes when a version prefix was dropped", () => {
    const { notes } = resolveNames([
      { name: "a", declared: false, httpMethod: "GET", pathTemplate: "/v1/trips" },
    ]);
    expect(notes.some((n) => n.includes("version"))).toBe(true);
  });

  it("spends grouping words in reserve before ever numbering a name", () => {
    const { names, collisions } = resolveNames([
      { name: "a", declared: false, httpMethod: "GET", pathTemplate: "/v1/pricing/" },
      { name: "b", declared: false, httpMethod: "GET", pathTemplate: "/v1/admin/pricing/" },
    ]);
    expect(names).toContain("get-pricing");
    expect(names).toContain("get-admin-pricing");
    expect(collisions).toHaveLength(0);
  });

  it("reports a numeric suffix as a collision, never silently", () => {
    // Identical routes with a method-equal verb skip the method suffix
    // ("get-trip-get" says nothing) and land on the counter.
    const { names, collisions } = resolveNames([
      { name: "a", declared: false, httpMethod: "GET", pathTemplate: "/v1/trips/{trip_id}" },
      { name: "b", declared: false, httpMethod: "GET", pathTemplate: "/v1/trips/{trip_id}" },
    ]);
    expect(names[1]).toBe("get-trip-2");
    expect(collisions).toEqual(["get-trip"]);
  });

  it("keeps names under 30 characters by spending less context", () => {
    const { names, notes } = resolveNames([
      {
        name: "a",
        declared: false,
        httpMethod: "GET",
        pathTemplate: "/v1/users/me/featured-trips",
      },
    ]);
    expect(names[0]).toBe("list-featured-trips");
    expect((names[0] as string).length).toBeLessThanOrEqual(30);
    expect(notes.some((n) => n.includes("30 characters"))).toBe(true);
  });

  it("adds the parent for member-POST association names", () => {
    const { names } = resolveNames([
      {
        name: "a",
        declared: false,
        httpMethod: "POST",
        pathTemplate: "/v1/bucket-list/destinations/{slug}",
      },
    ]);
    expect(names[0]).toBe("add-bucket-list-destination");
  });

  it("never produces duplicate or invalid names", () => {
    const inputs = [
      { name: "a", declared: false, httpMethod: "GET", pathTemplate: "/v1/trips" },
      { name: "b", declared: false, httpMethod: "GET", pathTemplate: "/v2/trips" },
      { name: "list-trips", declared: true },
      { name: "c", declared: false, httpMethod: "POST", pathTemplate: "/v1/trips" },
    ];
    const { names } = resolveNames(inputs);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(TOOL_NAME_PATTERN);
  });
});
