import * as path from "path";

function isAbsolutePathCrossPlatform(filePath: string): boolean {
  return path.isAbsolute(filePath) || /^[A-Za-z]:[/\\]/.test(filePath);
}

export function resolveDiagnosticPath(filePath: string, baseDirectory: string): string {
  return isAbsolutePathCrossPlatform(filePath) ? filePath : path.resolve(baseDirectory, filePath);
}
