/**
 * The HTTP port: the global `fetch` narrowed to what a check needs.
 *
 * The response is returned even for 4xx/5xx — a 500 is an observation about the
 * product, not a transport failure. `err` is reserved for "no response at all".
 * Redirects are not followed by default: a token redirect is a signal worth
 * recording, not a detour worth taking silently.
 */
import type { HttpPort, HttpRequest, HttpResponse } from "../../contracts/ports";
import { err, failure, ok, type Result } from "../../contracts/result";

const DEFAULT_TIMEOUT_MS = 15_000;

export function createHttpPort(): HttpPort {
  return {
    async request(request: HttpRequest): Promise<Result<HttpResponse>> {
      const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const init: RequestInit = {
        method: request.method ?? "GET",
        ...(request.headers === undefined ? {} : { headers: { ...request.headers } }),
        ...(request.body === undefined ? {} : { body: request.body }),
        redirect: request.followRedirects === true ? "follow" : "manual",
        signal: AbortSignal.timeout(timeoutMs),
      };
      try {
        const response = await fetch(request.url, init);
        const headers: Record<string, string> = {};
        response.headers.forEach((value, name) => {
          headers[name] = value;
        });
        const setCookie =
          typeof (response.headers as { getSetCookie?: () => string[] }).getSetCookie === "function"
            ? (response.headers as { getSetCookie: () => string[] }).getSetCookie()
            : [];
        const body = await response.text();
        return ok({ status: response.status, headers, body, setCookie });
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        if (name === "TimeoutError" || name === "AbortError") {
          return err(
            failure("timeout", `${request.method ?? "GET"} ${request.url} timed out after ${timeoutMs} ms`, "check that the instance is up, then retry"),
          );
        }
        return err(
          failure(
            "io",
            `${request.method ?? "GET"} ${request.url} failed: ${error instanceof Error ? error.message : String(error)}`,
            "the instance may not be listening yet",
          ),
        );
      }
    },
  };
}
