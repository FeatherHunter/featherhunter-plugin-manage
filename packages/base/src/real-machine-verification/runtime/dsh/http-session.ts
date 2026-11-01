/**
 * Talking to a running instance over its local HTTP API.
 *
 * The access URL carries a one-time token. Two calls follow it:
 *
 * 1. `GET /connect?token=...` (no extra parameters) answers `302` plus a
 *    `dsh-auth-...` session cookie. The token alone is not a session; without the
 *    cookie every later call is rejected. This was verified against a real
 *    instance: the connect route rejects unknown query parameters.
 * 2. `POST /api/<endpoint>` with a `client-request` envelope is the *single*
 *    channel the web client uses to invoke host RPCs; an endpoint may contain a
 *    slash (`pluginInventory/list`). The payload must be exactly one plain
 *    object under `args` — sending the object as the payload itself makes the
 *    gateway answer HTTP 200 with `result.ok = false` and
 *    `"Remote payload must contain exactly one plain-object args field"`.
 *
 * The endpoint names are host-defined and may move between releases, so this
 * module is deliberately thin: callers name the endpoints they need; when one is
 * missing, the caller reports `blocked` with the endpoint in the hint rather
 * than guessing.
 */
import type { ClockPort, HttpPort, HttpResponse } from "../../contracts/ports";
import { originOf, type ReadyUrl } from "../../contracts/launch-plan";
import { err, ok, type Result } from "../../contracts/result";

/** One row of `pluginInventory/list`: a host entry and its fiber lifecycle state. */
export interface InventoryEntry {
  readonly entryId: string;
  readonly moduleName: string | null;
  readonly enabled: boolean;
  /** `null` for disabled entries (they have no fiber); a string once one exists. */
  readonly fiberPhase: string | null;
}

/** An enabled entry whose fiber is not `active` — the reason an instance is not ready. */
export interface InventoryOffender {
  readonly entryId: string;
  readonly fiberPhase: string | null;
}

/** The ready criterion derived from `pluginInventory/list`. */
export interface InventoryReadiness {
  readonly entryCount: number;
  readonly enabledCount: number;
  readonly activeCount: number;
  readonly offenders: readonly InventoryOffender[];
  /** Every enabled entry is active, and the inventory is not empty. */
  readonly allReady: boolean;
  readonly managementAvailable: boolean | null;
}

export interface HostSession {
  readonly origin: string;
  readonly token: string;
  /** HTTP status of the connect handshake (302 on a real host), for readiness evidence. */
  readonly status: number;
  /** Session cookie header (`name=value` pairs joined with `; `). */
  readonly cookie: string;
  /** GET a path on the instance; the caller decides which status means what. */
  get(path: string, options?: { readonly timeoutMs?: number }): Promise<Result<HttpResponse>>;
  /**
   * Invoke one host RPC. `args` becomes the single `args` field of the payload;
   * the value of `result.value` is returned on success.
   */
  call(
    endpoint: string,
    args?: Readonly<Record<string, unknown>>,
    options?: { readonly timeoutMs?: number },
  ): Promise<Result<unknown>>;
}

export interface ConnectHostOptions {
  readonly http: HttpPort;
  readonly clock: ClockPort;
  readonly ready: ReadyUrl;
  readonly timeoutMs?: number;
}

/** Join every `set-cookie` pair into one `Cookie` header (attributes dropped). */
export function cookieHeaderFrom(response: HttpResponse): string {
  return response.setCookie
    .map((value) => value.split(";")[0]?.trim() ?? "")
    .filter((value) => value.length > 0)
    .join("; ");
}

/**
 * Exchange the token for a session cookie.
 *
 * A 401/403 here is a *prerequisite* failure, not a bug: the token was rejected,
 * which normally means the instance was restarted or the URL came from a stale
 * `instance.json`.
 */
export async function connectHost(options: ConnectHostOptions): Promise<Result<HostSession>> {
  const origin = originOf(options.ready);
  const url = `${origin}/connect?token=${encodeURIComponent(options.ready.token)}`;
  const response = await options.http.request({
    url,
    method: "GET",
    timeoutMs: options.timeoutMs ?? 15_000,
    followRedirects: false,
  });
  if (!response.ok) return response;

  const status = response.value.status;
  if (status === 401 || status === 403) {
    return err({
      code: "prerequisite",
      message: `the instance rejected the access token (HTTP ${status})`,
      hint: "the instance may have restarted; launch again and use the new instance.json",
    });
  }
  if (status >= 500) {
    return err({
      code: "prerequisite",
      message: `the instance failed the connect handshake (HTTP ${status})`,
      hint: response.value.body.slice(0, 300),
    });
  }
  if (status < 200 || status >= 400) {
    return err({
      code: "prerequisite",
      message: `the instance answered the connect handshake with HTTP ${status}`,
      hint: response.value.body.slice(0, 300),
    });
  }

  const cookie = cookieHeaderFrom(response.value);
  let counter = 0;
  const session: HostSession = {
    origin,
    token: options.ready.token,
    status,
    cookie,
    get: async (path, getOptions) => {
      const result = await options.http.request({
        url: `${origin}${path.startsWith("/") ? path : `/${path}`}`,
        method: "GET",
        ...(cookie.length === 0 ? {} : { headers: { Cookie: cookie } }),
        timeoutMs: getOptions?.timeoutMs ?? 15_000,
        followRedirects: false,
      });
      return result;
    },
    call: async (endpoint, args, callOptions) => {
      counter += 1;
      const rpcId = `verify-${options.clock.nowMs().toString(36)}-${counter}`;
      const body = JSON.stringify({
        type: "client-request",
        rpcId,
        method: endpoint,
        payload: { args: args ?? {} },
      });
      const response = await options.http.request({
        url: `${origin}/api/${endpoint}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          ...(cookie.length === 0 ? {} : { Cookie: cookie }),
        },
        body,
        timeoutMs: callOptions?.timeoutMs ?? 30_000,
        followRedirects: false,
      });
      if (!response.ok) return response;
      if (response.value.status < 200 || response.value.status >= 300) {
        return err({
          code: "prerequisite",
          message: `host RPC ${endpoint} answered HTTP ${response.value.status}`,
          hint: response.value.body.slice(0, 300),
        });
      }
      let envelope: unknown;
      try {
        envelope = JSON.parse(response.value.body) as unknown;
      } catch {
        return err({
          code: "io",
          message: `host RPC ${endpoint} did not answer JSON`,
          hint: response.value.body.slice(0, 200),
        });
      }
      return unwrapRpcEnvelope(envelope, endpoint);
    },
  };
  return ok(session);
}

interface RpcError {
  readonly code?: unknown;
  readonly message?: unknown;
}

/** Read `result.ok`/`result.value`; a `result.ok = false` becomes an error. */
function unwrapRpcEnvelope(envelope: unknown, endpoint: string): Result<unknown> {
  if (typeof envelope !== "object" || envelope === null) {
    return err({
      code: "io",
      message: `host RPC ${endpoint} did not answer a server-response envelope`,
    });
  }
  const result = (envelope as { readonly result?: unknown }).result;
  if (typeof result !== "object" || result === null) {
    return err({
      code: "io",
      message: `host RPC ${endpoint} did not answer a server-response envelope`,
      hint: JSON.stringify(envelope).slice(0, 200),
    });
  }
  const { ok: succeeded, value, error } = result as {
    readonly ok?: unknown;
    readonly value?: unknown;
    readonly error?: RpcError;
  };
  if (succeeded === true) return ok(value);
  const message = typeof error?.message === "string" ? error.message : `host RPC ${endpoint} failed`;
  const code = typeof error?.code === "string" ? error.code : null;
  return err({
    code: "prerequisite",
    message,
    ...(code === null ? {} : { details: { remoteCode: code } }),
  });
}

/**
 * Ask the running host which entries it loaded and whether every enabled one has
 * finished activating. This is the structural half of the readiness criterion:
 * the token URL proves the process printed a line, the inventory proves the
 * plugin loader actually finished.
 */
export async function pluginInventoryReadiness(
  session: Pick<HostSession, "call">,
): Promise<Result<InventoryReadiness>> {
  const value = await session.call("pluginInventory/list", {});
  if (!value.ok) return value;
  const inventory = value.value;
  if (typeof inventory !== "object" || inventory === null) {
    return err({
      code: "prerequisite",
      message: "pluginInventory/list did not answer an inventory object",
      hint: JSON.stringify(inventory).slice(0, 200),
    });
  }
  const rawEntries = (inventory as { readonly entries?: unknown }).entries;
  if (!Array.isArray(rawEntries)) {
    return err({
      code: "prerequisite",
      message: "pluginInventory/list did not answer an entries array",
      hint: JSON.stringify(inventory).slice(0, 200),
    });
  }
  const entries = rawEntries.map(readInventoryEntry);
  const enabled = entries.filter((entry) => entry.enabled);
  const offenders = enabled
    .filter((entry) => entry.fiberPhase !== "active")
    .map((entry) => ({ entryId: entry.entryId, fiberPhase: entry.fiberPhase }));
  const managementAvailable = (inventory as { readonly managementAvailable?: unknown }).managementAvailable;
  return ok({
    entryCount: entries.length,
    enabledCount: enabled.length,
    activeCount: enabled.filter((entry) => entry.fiberPhase === "active").length,
    offenders,
    allReady: entries.length > 0 && offenders.length === 0,
    managementAvailable: typeof managementAvailable === "boolean" ? managementAvailable : null,
  });
}

function readInventoryEntry(raw: unknown): InventoryEntry {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const entryId = typeof record["entryId"] === "string" ? record["entryId"] : "";
  const moduleName = typeof record["moduleName"] === "string" ? record["moduleName"] : null;
  const enabled = record["enabled"] === true;
  const phase = record["fiberPhase"];
  return {
    entryId,
    moduleName,
    enabled,
    fiberPhase: typeof phase === "string" ? phase : null,
  };
}

/**
 * Wait until the web server answers a plain page request.
 *
 * The readiness line proves the process printed a URL; this proves the server is
 * accepting requests. They are different claims, and a run that reports "the
 * instance is reachable" should mean the second one.
 */
export async function waitForOrigin(
  http: HttpPort,
  clock: ClockPort,
  ready: ReadyUrl,
  options: { readonly timeoutMs?: number; readonly pollMs?: number } = {},
): Promise<Result<{ readonly status: number; readonly elapsedMs: number }>> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const pollMs = options.pollMs ?? 200;
  const startedAt = clock.nowMs();
  const deadline = startedAt + timeoutMs;
  let lastStatus = 0;
  while (clock.nowMs() <= deadline) {
    const response = await http.request({
      url: `${originOf(ready)}/`,
      method: "GET",
      timeoutMs: 5_000,
      followRedirects: false,
    });
    if (response.ok) {
      lastStatus = response.value.status;
      if (lastStatus === 200) return ok({ status: lastStatus, elapsedMs: clock.nowMs() - startedAt });
    }
    await clock.sleep(pollMs);
  }
  return err({
    code: "timeout",
    message: `the instance did not serve its origin within ${timeoutMs}ms`,
    hint: `last HTTP status: ${lastStatus === 0 ? "(no response)" : String(lastStatus)}`,
  });
}
