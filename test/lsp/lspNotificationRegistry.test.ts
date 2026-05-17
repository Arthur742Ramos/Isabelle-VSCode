import { describe, expect, it } from "vitest";
import { LspNotificationRegistry } from "../../src/lsp/lspNotificationRegistry";

describe("LspNotificationRegistry", () => {
  it("starts empty", () => {
    const reg = new LspNotificationRegistry();
    expect(reg.entries()).toEqual([]);
    expect(reg.methodCount()).toBe(0);
    expect(reg.handlerCount()).toBe(0);
  });

  it("registers a single handler for a method", () => {
    const reg = new LspNotificationRegistry();
    const handler = (): void => {};
    reg.add("PIDE/sledgehammer_status", handler);
    const [entry] = reg.entries();
    expect(entry[0]).toBe("PIDE/sledgehammer_status");
    expect(entry[1]).toEqual([handler]);
    expect(reg.methodCount()).toBe(1);
    expect(reg.handlerCount()).toBe(1);
  });

  it("registers multiple handlers for the same method, preserving insertion order", () => {
    const reg = new LspNotificationRegistry();
    const first = (): void => {};
    const second = (): void => {};
    const third = (): void => {};
    reg.add("PIDE/sledgehammer_output", first);
    reg.add("PIDE/sledgehammer_output", second);
    reg.add("PIDE/sledgehammer_output", third);
    const [entry] = reg.entries();
    expect(entry[1]).toEqual([first, second, third]);
    expect(reg.handlerCount()).toBe(3);
  });

  it("registers handlers for distinct methods independently", () => {
    const reg = new LspNotificationRegistry();
    const statusHandler = (): void => {};
    const outputHandler = (): void => {};
    reg.add("PIDE/sledgehammer_status", statusHandler);
    reg.add("PIDE/sledgehammer_output", outputHandler);
    const map = new Map(reg.entries());
    expect(map.get("PIDE/sledgehammer_status")).toEqual([statusHandler]);
    expect(map.get("PIDE/sledgehammer_output")).toEqual([outputHandler]);
    expect(reg.methodCount()).toBe(2);
    expect(reg.handlerCount()).toBe(2);
  });

  it("removes a handler when its subscription is disposed", () => {
    const reg = new LspNotificationRegistry();
    const keep = (): void => {};
    const drop = (): void => {};
    reg.add("PIDE/sledgehammer_status", keep);
    const sub = reg.add("PIDE/sledgehammer_status", drop);
    sub.dispose();
    const [entry] = reg.entries();
    expect(entry[1]).toEqual([keep]);
    expect(reg.handlerCount()).toBe(1);
  });

  it("removes the method entry entirely once its last handler is disposed", () => {
    const reg = new LspNotificationRegistry();
    const sub = reg.add("PIDE/sledgehammer_status", () => {});
    sub.dispose();
    expect(reg.entries()).toEqual([]);
    expect(reg.methodCount()).toBe(0);
    expect(reg.handlerCount()).toBe(0);
  });

  it("treats repeated dispose calls as no-ops", () => {
    const reg = new LspNotificationRegistry();
    const sub = reg.add("PIDE/sledgehammer_status", () => {});
    sub.dispose();
    sub.dispose();
    sub.dispose();
    expect(reg.entries()).toEqual([]);
  });

  it("tolerates dispose after clear without throwing", () => {
    const reg = new LspNotificationRegistry();
    const sub = reg.add("PIDE/sledgehammer_status", () => {});
    reg.clear();
    expect(() => sub.dispose()).not.toThrow();
    expect(reg.entries()).toEqual([]);
  });

  it("clear empties every method without affecting future registrations", () => {
    const reg = new LspNotificationRegistry();
    reg.add("PIDE/sledgehammer_status", () => {});
    reg.add("PIDE/sledgehammer_output", () => {});
    reg.clear();
    expect(reg.entries()).toEqual([]);

    const afterClear = (): void => {};
    reg.add("PIDE/sledgehammer_status", afterClear);
    expect(reg.entries()).toEqual([["PIDE/sledgehammer_status", [afterClear]]]);
  });

  it("allows the same handler reference to be registered for two distinct methods", () => {
    const reg = new LspNotificationRegistry();
    const shared = (): void => {};
    reg.add("PIDE/sledgehammer_status", shared);
    reg.add("PIDE/sledgehammer_output", shared);
    expect(reg.handlerCount()).toBe(2);
    expect(reg.methodCount()).toBe(2);
  });

  it("deduplicates the same handler reference registered twice for the same method", () => {
    // Mirrors Set semantics — registering the same function twice does not
    // double-fire. Callers who need multiple subscriptions to the same
    // method should pass distinct closures.
    const reg = new LspNotificationRegistry();
    const handler = (): void => {};
    reg.add("PIDE/sledgehammer_status", handler);
    reg.add("PIDE/sledgehammer_status", handler);
    const [entry] = reg.entries();
    expect(entry[1]).toEqual([handler]);
    expect(reg.handlerCount()).toBe(1);
  });
});
