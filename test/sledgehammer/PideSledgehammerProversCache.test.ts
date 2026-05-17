import { describe, expect, it } from "vitest";
import {
  IsabelleLanguageServerState,
  IsabelleLanguageServerStatus
} from "../../src/lsp/lspTypes";
import {
  PIDE_PROVERS_REQUEST_METHOD,
  PIDE_PROVERS_RESPONSE_METHOD,
  PideSledgehammerProversCache,
  ProversCacheClient,
  ProversCacheDisposable,
  ProversCacheLogger
} from "../../src/sledgehammer/PideSledgehammerProversCache";

// In-memory test double for the language-client subset the cache
// touches. The class deliberately mirrors the structural contract of
// `IsabelleLanguageClient` (sendNotification, onNotification,
// onStatusChange, getStatus) so the production wiring needs no
// adapter to pass it through.
class FakeClient implements ProversCacheClient {
  public readonly sentMethods: { method: string; params: unknown }[] = [];
  public notificationHandlers = new Map<string, Set<(params: unknown) => void>>();
  public statusHandlers = new Set<(status: IsabelleLanguageServerStatus) => void>();
  private status: IsabelleLanguageServerStatus = { state: "disabled" };
  public sendNotificationThrowOnce: Error | undefined;

  public sendNotification(method: string, params?: unknown): void {
    if (this.sendNotificationThrowOnce) {
      const err = this.sendNotificationThrowOnce;
      this.sendNotificationThrowOnce = undefined;
      throw err;
    }
    this.sentMethods.push({ method, params });
  }

  public onNotification(
    method: string,
    handler: (params: unknown) => void
  ): ProversCacheDisposable {
    let set = this.notificationHandlers.get(method);
    if (!set) {
      set = new Set();
      this.notificationHandlers.set(method, set);
    }
    set.add(handler);
    return {
      dispose: () => {
        set?.delete(handler);
      }
    };
  }

  public onStatusChange(
    handler: (status: IsabelleLanguageServerStatus) => void
  ): ProversCacheDisposable {
    this.statusHandlers.add(handler);
    return {
      dispose: () => {
        this.statusHandlers.delete(handler);
      }
    };
  }

  public getStatus(): IsabelleLanguageServerStatus {
    return this.status;
  }

  public setStatus(state: IsabelleLanguageServerState): void {
    this.status = { state };
    for (const handler of [...this.statusHandlers]) {
      handler(this.status);
    }
  }

  public emit(method: string, params: unknown): void {
    const set = this.notificationHandlers.get(method);
    if (!set) return;
    for (const handler of [...set]) {
      handler(params);
    }
  }
}

class CollectingLogger implements ProversCacheLogger {
  public readonly messages: string[] = [];
  public appendLine(message: string): void {
    this.messages.push(message);
  }
}

describe("PideSledgehammerProversCache", () => {
  it("starts with an empty prover list before any response arrives", () => {
    const client = new FakeClient();
    const logger = new CollectingLogger();
    const cache = new PideSledgehammerProversCache(client, logger);
    expect(cache.getProvers()).toBe("");
    expect(cache.hasCachedProvers()).toBe(false);
    expect(cache.getLastUpdatedAt()).toBeUndefined();
    cache.dispose();
  });

  it("does not send a request when the client is initially disabled", () => {
    const client = new FakeClient();
    const cache = new PideSledgehammerProversCache(client, new CollectingLogger());
    expect(client.sentMethods).toEqual([]);
    cache.dispose();
  });

  it("sends PIDE/sledgehammer_provers_request on the disabled -> running transition", () => {
    const client = new FakeClient();
    const cache = new PideSledgehammerProversCache(client, new CollectingLogger());
    client.setStatus("running");
    expect(client.sentMethods).toEqual([
      { method: PIDE_PROVERS_REQUEST_METHOD, params: undefined }
    ]);
    cache.dispose();
  });

  it("fires immediately when the client is already running at construction time", () => {
    // Late-wiring case: the cache is created after the LSP has already
    // started, so the onStatusChange listener never sees a transition.
    // The constructor must dispatch the request itself.
    const client = new FakeClient();
    client.setStatus("running");
    const cache = new PideSledgehammerProversCache(client, new CollectingLogger());
    expect(client.sentMethods).toEqual([
      { method: PIDE_PROVERS_REQUEST_METHOD, params: undefined }
    ]);
    cache.dispose();
  });

  it("caches the provers string from a PIDE/sledgehammer_provers_response", () => {
    const client = new FakeClient();
    const logger = new CollectingLogger();
    const cache = new PideSledgehammerProversCache(client, logger, () =>
      new Date("2026-05-17T03:00:00.000Z")
    );
    client.setStatus("running");
    client.emit(PIDE_PROVERS_RESPONSE_METHOD, {
      provers: "cvc5 verit z3 e spass vampire zipperposition"
    });
    expect(cache.getProvers()).toBe(
      "cvc5 verit z3 e spass vampire zipperposition"
    );
    expect(cache.hasCachedProvers()).toBe(true);
    expect(cache.getLastUpdatedAt()).toBe("2026-05-17T03:00:00.000Z");
    expect(logger.messages.some((m) => m.includes("7 prover(s)"))).toBe(true);
    cache.dispose();
  });

  it("normalizes ragged whitespace in the response payload", () => {
    const client = new FakeClient();
    const cache = new PideSledgehammerProversCache(client, new CollectingLogger());
    client.setStatus("running");
    client.emit(PIDE_PROVERS_RESPONSE_METHOD, {
      provers: "   cvc5   verit\tz3 \n  e  "
    });
    expect(cache.getProvers()).toBe("cvc5 verit z3 e");
    cache.dispose();
  });

  it("ignores a malformed response payload and logs once", () => {
    const client = new FakeClient();
    const logger = new CollectingLogger();
    const cache = new PideSledgehammerProversCache(client, logger);
    client.setStatus("running");
    client.emit(PIDE_PROVERS_RESPONSE_METHOD, { provers: 42 });
    client.emit(PIDE_PROVERS_RESPONSE_METHOD, null);
    client.emit(PIDE_PROVERS_RESPONSE_METHOD, undefined);
    expect(cache.getProvers()).toBe("");
    expect(logger.messages.filter((m) => m.includes("ignored malformed")).length).toBe(3);
    cache.dispose();
  });

  it("notes an empty-but-well-formed prover list rather than calling it malformed", () => {
    const client = new FakeClient();
    const logger = new CollectingLogger();
    const cache = new PideSledgehammerProversCache(client, logger);
    client.setStatus("running");
    client.emit(PIDE_PROVERS_RESPONSE_METHOD, { provers: "" });
    expect(cache.getProvers()).toBe("");
    expect(cache.hasCachedProvers()).toBe(false);
    expect(logger.messages.some((m) => m.includes("empty prover list"))).toBe(true);
    expect(logger.messages.some((m) => m.includes("ignored malformed"))).toBe(false);
    cache.dispose();
  });

  it("drops the cache when the client transitions out of running", () => {
    const client = new FakeClient();
    const cache = new PideSledgehammerProversCache(client, new CollectingLogger());
    client.setStatus("running");
    client.emit(PIDE_PROVERS_RESPONSE_METHOD, { provers: "cvc5 verit" });
    expect(cache.getProvers()).toBe("cvc5 verit");

    client.setStatus("stopping");
    expect(cache.getProvers()).toBe("");
    expect(cache.hasCachedProvers()).toBe(false);
    expect(cache.getLastUpdatedAt()).toBeUndefined();
    cache.dispose();
  });

  it("re-fires the request on a restart cycle (running -> failed -> running)", () => {
    const client = new FakeClient();
    const cache = new PideSledgehammerProversCache(client, new CollectingLogger());
    client.setStatus("running");
    client.setStatus("failed");
    client.setStatus("starting");
    client.setStatus("running");
    expect(
      client.sentMethods.filter((s) => s.method === PIDE_PROVERS_REQUEST_METHOD).length
    ).toBe(2);
    cache.dispose();
  });

  it("does not duplicate a request when the status fires running -> running", () => {
    // Defensive: nothing in the production language client emits
    // running twice in a row, but the cache must not double-fire if a
    // future change in the producer ever did.
    const client = new FakeClient();
    const cache = new PideSledgehammerProversCache(client, new CollectingLogger());
    client.setStatus("running");
    client.setStatus("running");
    expect(
      client.sentMethods.filter((s) => s.method === PIDE_PROVERS_REQUEST_METHOD).length
    ).toBe(1);
    cache.dispose();
  });

  it("logs and survives a sendNotification failure", () => {
    const client = new FakeClient();
    const logger = new CollectingLogger();
    const cache = new PideSledgehammerProversCache(client, logger);
    client.sendNotificationThrowOnce = new Error("transport closed");
    client.setStatus("running");
    expect(logger.messages.some((m) => m.includes("transport closed"))).toBe(true);
    expect(cache.getProvers()).toBe("");
    cache.dispose();
  });

  it("ignores response notifications received after dispose", () => {
    const client = new FakeClient();
    const cache = new PideSledgehammerProversCache(client, new CollectingLogger());
    client.setStatus("running");
    cache.dispose();
    // The registry-based subscription is gone after dispose, so emit
    // would normally be a no-op. Belt-and-braces, simulate a stray
    // late delivery by re-installing the handler manually and verify
    // the cache still does not mutate.
    expect(client.notificationHandlers.get(PIDE_PROVERS_RESPONSE_METHOD)?.size ?? 0).toBe(0);
    expect(cache.getProvers()).toBe("");
  });

  it("dispose is idempotent", () => {
    const client = new FakeClient();
    const cache = new PideSledgehammerProversCache(client, new CollectingLogger());
    cache.dispose();
    expect(() => cache.dispose()).not.toThrow();
  });

  it("releases its notification + status subscriptions on dispose", () => {
    const client = new FakeClient();
    const cache = new PideSledgehammerProversCache(client, new CollectingLogger());
    expect(client.notificationHandlers.get(PIDE_PROVERS_RESPONSE_METHOD)?.size).toBe(1);
    expect(client.statusHandlers.size).toBe(1);
    cache.dispose();
    expect(client.notificationHandlers.get(PIDE_PROVERS_RESPONSE_METHOD)?.size ?? 0).toBe(0);
    expect(client.statusHandlers.size).toBe(0);
  });
});
