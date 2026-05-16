import * as path from "path";

export function resolveDiagnosticPath(filePath: string, baseDirectory: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(baseDirectory, filePath);
}
