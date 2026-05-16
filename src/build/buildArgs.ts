export interface BuildCommandOptions {
  isabelleExecutablePath: string;
  sessionName: string;
  rootDirectories: string[];
  extraArgs?: string[];
}

export interface BuildCommand {
  command: string;
  args: string[];
}

export function createBuildCommand(options: BuildCommandOptions): BuildCommand {
  const roots = [...new Set(options.rootDirectories.filter((root) => root.trim().length > 0))];
  const args = [
    "build",
    ...roots.flatMap((root) => ["-d", root]),
    ...(options.extraArgs ?? []),
    options.sessionName
  ];

  return {
    command: options.isabelleExecutablePath,
    args
  };
}
