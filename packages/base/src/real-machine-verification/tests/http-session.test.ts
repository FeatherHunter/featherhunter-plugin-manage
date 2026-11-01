/**
 * The host HTTP protocol, pinned item by item.
 *
 * These are the facts a real session established: one POST channel
 * `/api/<endpoint>`, an `{args}` payload, an `Origin` header, and the
 * `result.ok`/`result.value` envelope. Any drift here turns readiness into a
 * guess, so every request shape is asserted literally against a fake HttpPort.
 */
import { describe, expect, it } from "vitest";

import { originOf, type ReadyUrl } from "../contracts/launch-plan";
import type { HttpRequest, HttpResponse, HttpPort } from "../contracts/ports";
import { err, ok, type Result } from "../contracts/result";
import { FakeClock } from "./support/fake-fs";
import {
  connectHost,
  pluginInventoryReadiness,
  type HostSession,
} from "../runtime/dsh/http-session";

const READY: ReadyUrl = {
  url: "http://127.0.0.1:54321/?token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
  port: 54321,
  token: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
};
const ORIGIN = originOf(READY);

interface ScriptedHttp extends HttpPort {
  readonly requests: HttpRequest[];
}

function scriptedHttp(handler: (request: HttpRequest) => Result<HttpResponse>): ScriptedHttp {
  const requests: HttpRequest[] = [];
  return {
    requests,
    async request(request) {
      requests.push(request);
      return handler(request);
    },
  };
}

function response(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return { status: 200, headers: {}, body: "{}", setCookie: [], ...overrides };
}

function envelope(value: unknown): HttpResponse {
  return response({ body: JSON.stringify({ type: "server-response", rpcId: "r", result: { ok: true, value } }) });
}

async function connected(handler: (request: HttpRequest) => Result<HttpResponse> = () =>
  ok(response({ status: 302, setCookie: ["dsh-auth-abc=1; Path=/; HttpOnly"] }))): Promise<{
  session: HostSession;
  http: ScriptedHttp;
}> {
  const http = scriptedHttp(handler);
  const result = await connectHost({ http, clock: new FakeClock(), ready: READY });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("fixture session did not connect");
  return { session: result.value, http };
}

describe("connectHost", () => {
  it("calls /connect with the token and no extra query parameters", async () => {
    const { http } = await connected();

    expect(http.requests).toHaveLength(1);
    const request = http.requests[0];
    expect(request?.url).toBe(`${ORIGIN}/connect?token=${READY.token}`);
    expect(request?.url).not.toContain("interactions");
    expect(request?.method).toBe("GET");
    expect(request?.followRedirects).toBe(false);
  });

  it("joins every set-cookie value into one cookie header", async () => {
    const { http, session } = await connected(() =>
      ok(
        response({
          status: 302,
          setCookie: ["dsh-auth-a=1; Path=/; HttpOnly", "dsh-auth-b=2; SameSite=Lax"],
        }),
      ),
    );
    expect(http.requests).toHaveLength(1);
    expect(session.cookie).toBe("dsh-auth-a=1; dsh-auth-b=2");
    expect(session.origin).toBe(ORIGIN);
  });

  it("reports a rejected token as a prerequisite failure with a stale-record hint", async () => {
    const http = scriptedHttp(() => ok(response({ status: 401 })));
    const result = await connectHost({ http, clock: new FakeClock(), ready: READY });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("prerequisite");
    expect(result.error.message).toContain("401");
    expect(result.error.hint).toContain("instance.json");
  });
});

describe("session.call", () => {
  it("POSTs to /api/<endpoint> with the exact envelope the host accepts", async () => {
    const { session, http } = await connected((request) => {
      if (request.url.includes("/connect")) {
        return ok(response({ status: 302, setCookie: ["dsh-auth-abc=1"] }));
      }
      return ok(envelope({ entries: [] }));
    });
    const value = await session.call("pluginInventory/list", {});

    expect(value.ok).toBe(true);
    expect(http.requests).toHaveLength(2);
    const request = http.requests[1];
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe(`${ORIGIN}/api/pluginInventory/list`);
    expect(request?.headers?.["Content-Type"]).toBe("application/json");
    expect(request?.headers?.["Origin"]).toBe(ORIGIN);
    expect(request?.headers?.["Cookie"]).toBe("dsh-auth-abc=1");
    const body = JSON.parse(request?.body ?? "") as Record<string, unknown>;
    expect(body["type"]).toBe("client-request");
    expect(body["method"]).toBe("pluginInventory/list");
    expect(typeof body["rpcId"]).toBe("string");
    expect(body["payload"]).toEqual({ args: {} });
    // The gateway rejects any other payload shape; the wrapper is exact.
    expect(Object.keys(body["payload"] as Record<string, unknown>)).toEqual(["args"]);
  });

  it("forwards args under the single args field", async () => {
    const { session, http } = await connected((request) =>
      request.url.includes("/connect")
        ? ok(response({ status: 302, setCookie: ["dsh-auth-abc=1"] }))
        : ok(envelope({ thresholds: { minCheckCount: 3 } })),
    );
    await session.call("skills/list", { detail: "names" });
    const body = JSON.parse(http.requests[1]?.body ?? "") as Record<string, unknown>;
    expect(body["payload"]).toEqual({ args: { detail: "names" } });
  });

  it("returns result.value on success", async () => {
    const { session } = await connected((request) =>
      request.url.includes("/connect")
        ? ok(response({ status: 302, setCookie: ["dsh-auth-abc=1"] }))
        : ok(envelope({ entries: [{ entryId: "a" }] })),
    );
    const value = await session.call("pluginInventory/list", {});
    expect(value).toEqual({ ok: true, value: { entries: [{ entryId: "a" }] } });
  });

  it("turns result.ok=false into an error and keeps the remote code in details", async () => {
    const { session } = await connected((request) =>
      request.url.includes("/connect")
        ? ok(response({ status: 302, setCookie: ["dsh-auth-abc=1"] }))
        : ok(
            response({
              body: JSON.stringify({
                type: "server-response",
                rpcId: "r",
                result: {
                  ok: false,
                  error: {
                    code: "gateway/internal",
                    message: "Remote payload must contain exactly one plain-object args field",
                  },
                },
              }),
            }),
          ),
    );
    const value = await session.call("pluginInventory/list", {});
    expect(value.ok).toBe(false);
    if (value.ok) return;
    expect(value.error.code).toBe("prerequisite");
    expect(value.error.message).toContain("exactly one plain-object args field");
    expect(value.error.details).toEqual({ remoteCode: "gateway/internal" });
  });

  it("reports non-2xx and non-JSON answers as failures", async () => {
    const nonHttp = await connected((request) =>
      request.url.includes("/connect")
        ? ok(response({ status: 302, setCookie: ["dsh-auth-abc=1"] }))
        : ok(response({ status: 500, body: "boom" })),
    );
    const failed = await nonHttp.session.call("pluginInventory/list", {});
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.message).toContain("HTTP 500");

    const nonJson = await connected((request) =>
      request.url.includes("/connect")
        ? ok(response({ status: 302, setCookie: ["dsh-auth-abc=1"] }))
        : ok(response({ status: 200, body: "not json" })),
    );
    const broken = await nonJson.session.call("pluginInventory/list", {});
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.error.code).toBe("io");
  });
});

function inventory(entries: readonly unknown[], managementAvailable = true): unknown {
  return { managementAvailable, entries };
}

describe("pluginInventoryReadiness", () => {
  async function readiness(value: unknown) {
    const { session } = await connected((request) =>
      request.url.includes("/connect")
        ? ok(response({ status: 302, setCookie: ["dsh-auth-abc=1"] }))
        : ok(envelope(value)),
    );
    return pluginInventoryReadiness(session);
  }

  it("is ready when every enabled entry is active and disabled entries have no fiber", async () => {
    const result = await readiness(
      inventory([
        { entryId: "a", enabled: true, fiberPhase: "active" },
        { entryId: "b", enabled: true, fiberPhase: "active" },
        { entryId: "c", enabled: false, fiberPhase: null },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entryCount).toBe(3);
    expect(result.value.enabledCount).toBe(2);
    expect(result.value.activeCount).toBe(2);
    expect(result.value.offenders).toEqual([]);
    expect(result.value.allReady).toBe(true);
  });

  it("names an enabled entry that is not active as an offender", async () => {
    const result = await readiness(
      inventory([
        { entryId: "a", enabled: true, fiberPhase: "active" },
        { entryId: "pending-plugin", enabled: true, fiberPhase: "pending" },
        { entryId: "c", enabled: false, fiberPhase: null },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.allReady).toBe(false);
    expect(result.value.offenders).toEqual([{ entryId: "pending-plugin", fiberPhase: "pending" }]);
  });

  it("is not ready when the inventory is empty", async () => {
    const result = await readiness(inventory([]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entryCount).toBe(0);
    expect(result.value.allReady).toBe(false);
  });

  it("passes an RPC failure through instead of pretending readiness", async () => {
    const { session } = await connected((request) =>
      request.url.includes("/connect")
        ? ok(response({ status: 302, setCookie: ["dsh-auth-abc=1"] }))
        : ok(response({ status: 500, body: "nope" })),
    );
    const result = await pluginInventoryReadiness(session);
    expect(result.ok).toBe(false);
  });
});
