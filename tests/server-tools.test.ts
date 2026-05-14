import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.js";

describe("server tool registry — profile tools absent (SP-20260514-001)", () => {
  test("get_user_profile is NOT registered", () => {
    const server = createServer();
    const tools = Object.keys(
      (server as unknown as { _registeredTools: Record<string, unknown> })
        ._registeredTools,
    );
    assert.ok(
      !tools.includes("get_user_profile"),
      `Expected get_user_profile to be absent, but it is registered. Registered tools: ${tools.join(", ")}`,
    );
  });

  test("update_user_profile is NOT registered", () => {
    const server = createServer();
    const tools = Object.keys(
      (server as unknown as { _registeredTools: Record<string, unknown> })
        ._registeredTools,
    );
    assert.ok(
      !tools.includes("update_user_profile"),
      `Expected update_user_profile to be absent, but it is registered. Registered tools: ${tools.join(", ")}`,
    );
  });
});
