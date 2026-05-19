// Phase 2a live smoke test — opens examples/Smoke.thy, dispatches
// document/openTheory + document/checkWithPide against a backend
// process spawned with the right env vars + a real Isabelle install.
// Reports the per-request result.
//
// Not part of the npm test suite (requires a live Isabelle).
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const HOME = "C:/Tools/Isabelle2025-2/Isabelle2025-2";
const JAR = "backend/dist/isabelle-vscode-server.jar";
const SCRATCH = path.join(process.cwd(), "backend", "target", "smoke-scratch");

fs.mkdirSync(SCRATCH, { recursive: true });

const smokeText = fs.readFileSync("examples/Smoke.thy", "utf8");

const child = spawn("java", ["-jar", JAR], {
  env: Object.assign({}, process.env, {
    ISABELLE_HOME: HOME,
    ISABELLE_ROOT: HOME,
    CYGWIN_ROOT: HOME + "/contrib/cygwin",
    BACKEND_SCRATCH_DIR: SCRATCH
  }),
  stdio: ["pipe", "pipe", "pipe"]
});

let buffer = Buffer.alloc(0);
const responses = [];

child.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) break;
    const header = buffer.slice(0, headerEnd).toString("ascii");
    const m = header.match(/Content-Length:\s*(\d+)/i);
    if (!m) {
      console.error("malformed header", header);
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const len = parseInt(m[1], 10);
    if (buffer.length < headerEnd + 4 + len) break;
    const body = buffer.slice(headerEnd + 4, headerEnd + 4 + len).toString("utf8");
    buffer = buffer.slice(headerEnd + 4 + len);
    const parsed = JSON.parse(body);
    responses.push(parsed);
    console.log("← response", JSON.stringify(parsed, null, 2));
    if (parsed.id === "check") {
      console.log("CHECK COMPLETE — shutting down");
      child.kill("SIGTERM");
      setTimeout(() => process.exit(parsed.result?.status === "pide-ok" ? 0 : 1), 500);
    }
  }
});

child.stderr.on("data", (chunk) => {
  process.stderr.write("[backend.stderr] " + chunk.toString());
});

child.on("exit", (code, signal) => {
  console.log(`backend exited code=${code} signal=${signal}`);
  if (!responses.find(r => r.id === "check")) {
    process.exit(2);
  }
});

function send(request) {
  const body = JSON.stringify(request);
  const header = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n`;
  child.stdin.write(header + body);
  console.log("→ request", request.method, request.id);
}

setTimeout(() => {
  send({
    jsonrpc: "2.0",
    id: "open",
    method: "document/openTheory",
    protocolVersion: 1,
    params: {
      uri: "file:///examples/Smoke.thy",
      text: smokeText,
      version: 1,
      session: "HOL"
    }
  });

  setTimeout(() => {
    send({
      jsonrpc: "2.0",
      id: "check",
      method: "document/checkWithPide",
      protocolVersion: 1,
      params: {
        uri: "file:///examples/Smoke.thy",
        version: 1,
        session: "HOL",
        theoryName: "Smoke",
        workspaceUri: "file:///workspace/smoke",
        isabelleExecutablePath: HOME + "/bin/isabelle"
      }
    });
  }, 200);
}, 200);

// Backstop timeout — Isabelle bootstrap should complete within 60s.
setTimeout(() => {
  console.error("TIMEOUT — killing backend");
  try { child.kill("SIGKILL"); } catch (_) {}
  process.exit(3);
}, 120_000);
