/**
 * Talking to a running instance over its local HTTP API.
 *
 * The access URL carries a one-time token. Two calls follow it:
 *
 * 1. `GET /connect?token=...` answers with a session cookie (and a redirect).
 *    The token alone is not a session; without the cookie every later call is 401.
 * 2. `POST /api/<channel>/<endpoint>` with a `client-request` envelope is how the
 *    web client invokes host RPCs. Using it means a check can ask the *running
 *    host* what it registered instead of parsing its log or its files.
 *
 * The endpoint names are host-defined and may move between releases, so this
 * module is deliberately thin: it hands back a session object whose `call` is a
 * plain HTTP POST. Callers name the endpoints they need; when one is missing, the
 * check reports `blocked` with the endpoint in the hint rather than guessing.
 */
import type { ClockPort, HttpPort, HttpResponse } from "../../contracts/ports";
import { originOf, type ReadyUrl } from "../../contracts/launch-plan";
import { err, ok, type Result } from "../../contracts/result";

export interface HostSession {
  readonly origin: string;
  readonly token: string;
  /** Session cookie header (`name=value` pairs joined with `; `). */
  readonly cookie: string;
  /** GET a path on the instance; the caller decides which status means what. */
  get(path: string, options?: { readonly timeoutMs?: number }): Promise<Result<HttpResponse>>;
  /** POST one client-request RPC and return the parsed JSON body. */
  call(
    channel: string,
    endpoint: string,
    payload: unknown,
    options?: { readonly method?: string; readonly timeoutMs?: number },
  ): Promise<Result<unknown>>;
}

export interface ConnectHostOptions {
  readonly http: HttpPort;
  readonly clock: ClockPort;
  readonly ready: ReadyUrl;
  /** `none` suppresses interactive host prompts; a verification run has no human. */
  readonly interactions?: "none";
  readonly timeoutMs?: number;
}

function cookieHeaderFrom(response: HttpResponse): string {
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
  const interactions = options.interactions ?? "none";
  const url = `${origin}/connect?token=${encodeURIComponent(options.ready.token)}&interactions=${interactions}`;
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

  const cookie = cookieHeaderFrom(response.value);
  let counter = 0;
  const session: HostSession = {
    origin,
    token: options.ready.token,
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
    call: async (channel, endpoint, payload, callOptions) => {
      counter += 1;
      const rpcId = `verify-${options.clock.nowMs().toString(36)}-${counter}`;
      const body = JSON.stringify({
        type: "client-request",
        rpcId,
        method: callOptions?.method ?? endpoint,
        payload,
      });
      const response = await options.http.request({
        url: `${origin}/api/${channel}/${endpoint}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
          message: `host RPC ${channel}/${endpoint} answered HTTP ${response.value.status}`,
          hint: response.value.body.slice(0, 300),
        });
      }
      try {
        return ok(JSON.parse(response.value.body) as unknown);
      } catch {
        return err({
          code: "io",
          message: `host RPC ${channel}/${endpoint} did not answer JSON`,
          hint: response.value.body.slice(0, 200),
        });
      }
    },
  };
  return ok(session);
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
