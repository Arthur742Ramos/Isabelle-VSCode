# Install Java 21+

> **You can probably skip this step.** Per-platform `.vsix` builds from the
> VS Code Marketplace and GitHub Releases (`-win32-x64.vsix`,
> `-linux-x64.vsix`, `-darwin-arm64.vsix`, …) embed Eclipse Temurin 21
> under `extension/jre/`, so there is nothing to install on your machine.
> You only need to install Java yourself if you:
>
> - downloaded the **universal** `isabelle-pide-vscode-<version>.vsix` (no
>   suffix in the filename), or
> - built the extension **from source** (`npm run install:extension`).

The Isabelle PIDE extension ships a bundled Scala backend that runs as a fat jar via `java -jar`. For the two install paths above you need any **Java 21 or newer** runtime (any vendor: Microsoft OpenJDK, Adoptium Temurin, Oracle, etc.).

## Quick install

| OS | One-liner |
| --- | --- |
| **Windows** | `winget install Microsoft.OpenJDK.21` |
| **macOS** | `brew install --cask temurin@21` |
| **Debian / Ubuntu** | `sudo apt install openjdk-21-jdk` |
| **Fedora / RHEL** | `sudo dnf install java-21-openjdk` |
| **Arch** | `sudo pacman -S jdk21-openjdk` |
| Manual | Download from [adoptium.net/temurin/releases/?version=21](https://adoptium.net/temurin/releases/?version=21) |

After install, open a new terminal and confirm:

```
java -version
```

You should see something like `openjdk version "21.0.x" 2024-04-21 LTS`.

## After installing

[**Re-check setup**](command:isabelle.checkPrerequisites) refreshes this walkthrough so the green tick appears once Java is reachable.
