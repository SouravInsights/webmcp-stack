import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openapi } from "./openapi.js";

/**
 * A small but realistic spec: path + query params, a request body via $ref,
 * a 2xx response schema with a PII-looking field, one DELETE, and one
 * POST that behaves like a DELETE (cancel).
 */
const SPEC = `
openapi: 3.0.3
info: { title: Orders API, version: 1.0.0 }
security:
  - bearerAuth: []
paths:
  /orders:
    get:
      operationId: listOrders
      summary: List all orders
      parameters:
        - name: status
          in: query
          description: Only orders in this status
          schema: { type: string, enum: [open, shipped] }
        - name: authorization
          in: header
          schema: { type: string }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: array
                items: { $ref: "#/components/schemas/Order" }
    post:
      operationId: createOrder
      summary: Create a new order
      security: []
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/NewOrder" }
      responses:
        "201":
          description: created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Order" }
  /orders/{id}:
    get:
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Order" }
    delete:
      operationId: deleteOrder
      summary: Delete an order permanently
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      responses:
        "204": { description: gone }
components:
  schemas:
    Order:
      type: object
      required: [id, status]
      properties:
        id: { type: string }
        status: { type: string }
        email: { type: string }
    NewOrder:
      type: object
      required: [itemId]
      properties:
        itemId: { type: string }
        quantity: { type: integer }
`;

describe("openapi source", () => {
  let dir: string;
  let previousCwd: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "webmcp-codegen-"));
    await writeFile(join(dir, "openapi.yaml"), SPEC);
    previousCwd = process.cwd();
    process.chdir(dir);
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await rm(dir, { recursive: true, force: true });
  });

  it("turns every operation into a candidate tool", async () => {
    const tools = await openapi({ spec: "./openapi.yaml" }).collect();
    expect(tools.map((tool) => tool.name)).toEqual([
      "list-orders",
      "create-order",
      "get-order", // no operationId -> intent name from the route shape
      "delete-order",
    ]);
  });

  it("merges query params into the input schema and skips headers", async () => {
    const tools = await openapi({ spec: "./openapi.yaml" }).collect();
    const list = tools.find((tool) => tool.name === "list-orders");
    expect(Object.keys(list?.inputSchema.properties ?? {})).toEqual(["status"]);
    // Header params belong to the app's auth layer, not to the agent.
    expect(JSON.stringify(list?.inputSchema)).not.toContain("authorization");
  });

  it("flattens an object request body into the input schema, with refs resolved", async () => {
    const tools = await openapi({ spec: "./openapi.yaml" }).collect();
    const create = tools.find((tool) => tool.name === "create-order");
    expect(create?.inputSchema.required).toEqual(["itemId"]);
    expect(create?.inputSchema.properties?.quantity).toEqual({ type: "integer" });
    // No $ref may survive into the browser-facing schema.
    expect(JSON.stringify(create?.inputSchema)).not.toContain("$ref");
  });

  it("marks required path params", async () => {
    const tools = await openapi({ spec: "./openapi.yaml" }).collect();
    const getOne = tools.find((tool) => tool.name === "get-order");
    expect(getOne?.inputSchema.required).toEqual(["id"]);
  });

  it("captures output schemas (with refs resolved) for the PII scan", async () => {
    const tools = await openapi({ spec: "./openapi.yaml" }).collect();
    const getOne = tools.find((tool) => tool.name === "get-order");
    expect(getOne?.outputSchema?.properties?.email).toEqual({ type: "string" });
  });

  it("reads auth requirements from the spec, honoring per-operation overrides", async () => {
    const tools = await openapi({ spec: "./openapi.yaml" }).collect();
    const list = tools.find((tool) => tool.name === "list-orders");
    const create = tools.find((tool) => tool.name === "create-order");
    expect(list?.requiresAuth).toBe(true); // from the spec's root security
    expect(create?.requiresAuth).toBe(false); // explicit security: [] opts out
  });

  it("prefers summary, falls back to a method+path template", async () => {
    const tools = await openapi({ spec: "./openapi.yaml" }).collect();
    const list = tools.find((tool) => tool.name === "list-orders");
    const getOne = tools.find((tool) => tool.name === "get-order");
    expect(list?.description).toBe("List all orders");
    expect(list?.descriptionSource).toBe("openapi-summary");
    expect(getOne?.description).toBe("GET /orders/{id}");
    expect(getOne?.descriptionSource).toBe("generated-template");
  });

  it("fails clearly when the spec file is missing", async () => {
    await expect(openapi({ spec: "./nope.yaml" }).collect()).rejects.toThrow(
      /Could not read the OpenAPI spec/,
    );
  });
});
