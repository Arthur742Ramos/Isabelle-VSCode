// Pure registry of LSP notification handlers, factored out of
// IsabelleLanguageClient so it can be unit-tested without spinning up a
// vscode-languageclient instance or mocking the vscode namespace.
//
// The registry's only job is to remember the (method, handler) pairs the
// caller has subscribed to and to hand out a disposer for each
// subscription. The IsabelleLanguageClient is responsible for replaying
// these handlers onto each newly-started LanguageClient (handlers must
// survive client restart cycles) and for forwarding sendNotification
// calls only when a live client exists.

export type LspNotificationHandler = (params: unknown) => void;

export interface LspNotificationSubscription {
  /** Removes this subscription from the registry. Idempotent. */
  dispose(): void;
}

export class LspNotificationRegistry {
  private readonly handlers = new Map<string, Set<LspNotificationHandler>>();

  /**
   * Register a handler for a given LSP method. Returns a subscription
   * whose `dispose()` removes the handler. Calling `dispose()` more than
   * once is a no-op.
   */
  public add(method: string, handler: LspNotificationHandler): LspNotificationSubscription {
    let set = this.handlers.get(method);
    if (!set) {
      set = new Set<LspNotificationHandler>();
      this.handlers.set(method, set);
    }
    set.add(handler);

    let disposed = false;
    return {
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        const current = this.handlers.get(method);
        if (!current) {
          return;
        }
        current.delete(handler);
        if (current.size === 0) {
          this.handlers.delete(method);
        }
      }
    };
  }

  /**
   * Iterate over (method, handlers) pairs in insertion order. Intended
   * for the IsabelleLanguageClient to replay handlers onto a freshly
   * started LanguageClient.
   */
  public entries(): Array<[string, readonly LspNotificationHandler[]]> {
    return Array.from(this.handlers.entries(), ([method, set]) => [
      method,
      Array.from(set)
    ]);
  }

  /** Number of distinct methods with at least one handler. */
  public methodCount(): number {
    return this.handlers.size;
  }

  /** Total number of handlers across all methods. */
  public handlerCount(): number {
    let total = 0;
    for (const set of this.handlers.values()) {
      total += set.size;
    }
    return total;
  }

  /** Remove every subscription. Existing subscription dispose() calls remain safe. */
  public clear(): void {
    this.handlers.clear();
  }
}
