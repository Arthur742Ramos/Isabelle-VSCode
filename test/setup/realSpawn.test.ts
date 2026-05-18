import { describe, expect, it } from "vitest";
import { realSpawn } from "../../src/setup/runtime";

/**
 * Behavioural test for {@link realSpawn}'s hard-timeout semantics.
 *
 * The original implementation only sent SIGTERM and waited for the child
 * `close` event, so any child that ignored SIGTERM could leave the
 * activation-time prerequisite check pending forever. We now resolve the
 * promise as soon as the timeout fires and follow up with SIGKILL out of
 * band.
 */
describe("realSpawn — hard timeout", () => {
  it("resolves within the configured timeout even when the child does not exit", async () => {
    // `node -e "setInterval(()=>{},1000)"` spawns a process that never
    // returns from its own accord (and on Windows happens not to be
    // terminated by SIGTERM under all CI runners). The timeout must
    // still close out the spawn promise.
    const start = Date.now();
    const result = await realSpawn({
      command: process.execPath,
      args: ["-e", "setInterval(()=>{}, 1000); process.stdout.write('ready');"],
      timeoutMs: 600
    });
    const elapsed = Date.now() - start;
    expect(result.timedOut).toBe(true);
    expect(result.spawnFailed).toBe(false);
    // Allow generous slack for test-runner scheduling, but it absolutely
    // must not hang for several seconds while waiting for `close`.
    expect(elapsed).toBeLessThan(3500);
  }, 10_000);

  it("resolves cleanly when the child finishes before the timeout", async () => {
    const result = await realSpawn({
      command: process.execPath,
      args: ["-e", "process.stdout.write('hello'); process.exit(0)"],
      timeoutMs: 5000
    });
    expect(result.timedOut).toBe(false);
    expect(result.spawnFailed).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello");
  }, 10_000);

  it("returns spawnFailed when the binary does not exist", async () => {
    const result = await realSpawn({
      command: "definitely-does-not-exist-on-any-path-9c1e",
      args: [],
      timeoutMs: 1000
    });
    expect(result.spawnFailed).toBe(true);
    expect(result.timedOut).toBe(false);
  }, 5000);
});
