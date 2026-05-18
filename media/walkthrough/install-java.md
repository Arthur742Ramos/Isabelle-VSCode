# Install Java 21+

The Isabelle PIDE extension ships a bundled Scala backend that runs as a fat jar via `java -jar`. You need any **Java 21 or newer** runtime (any vendor: Microsoft OpenJDK, Adoptium Temurin, Oracle, etc.).

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

Click **Re-check setup** below to refresh this walkthrough.
