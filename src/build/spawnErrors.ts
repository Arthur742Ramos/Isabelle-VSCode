export function formatBuildSpawnError(error: NodeJS.ErrnoException, command: string): Error {
  if (error.code === "ENOENT") {
    return new Error(
      `Unable to start Isabelle build: command "${command}" was not found. ` +
        "Set isabelle.executablePath to the Isabelle executable path."
    );
  }

  return new Error(`Unable to start Isabelle build command "${command}": ${error.message}`);
}
