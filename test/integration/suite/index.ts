import * as path from "path";
import { glob } from "glob";
import Mocha from "mocha";

// Mocha runner that VS Code's extension host invokes after launching.
// `@vscode/test-electron` resolves this module from `extensionTestsPath`
// and calls the exported `run()` function.
export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
    timeout: 60_000
  });

  const testsRoot = path.resolve(__dirname);
  const files = await glob("**/*.test.js", { cwd: testsRoot });

  if (files.length === 0) {
    throw new Error(
      `No integration tests discovered under ${testsRoot}. Check that ` +
        `'tsc -p test/integration/tsconfig.json' has produced *.test.js files ` +
        `next to this runner.`
    );
  }

  for (const file of files) {
    mocha.addFile(path.resolve(testsRoot, file));
  }

  await new Promise<void>((resolve, reject) => {
    try {
      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} integration test(s) failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
