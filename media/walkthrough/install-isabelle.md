# Install Isabelle

The extension activates without Isabelle, but every feature that talks to Isabelle (build, language server, sledgehammer, real proof state, theory navigation against discovered sessions, repair verification) stays inert until **Isabelle 2019 or newer** is reachable.

## Download

Pick the installer for your platform from the official site:

- **[https://isabelle.in.tum.de/installation.html](https://isabelle.in.tum.de/installation.html)**

The latest release is `Isabelle2025` (~800 MB download). Run the installer and accept the default install path.

## Make `isabelle` reachable

The extension finds Isabelle through one of:

1. **`isabelle.executablePath` setting** (highest priority — set per workspace or globally).
2. **`isabelle` on your `PATH`** (everything-just-works default).

### Auto-detect

If you install Isabelle into a standard location, the extension can detect it for you. Click **Re-check setup** below — if a known installation is found, you'll be offered a one-click toast to use it. Standard locations probed:

| OS | Location |
| --- | --- |
| Windows | `%ProgramFiles%\Isabelle*`, `%LOCALAPPDATA%\Programs\Isabelle*` |
| macOS | `/Applications/Isabelle*`, `~/Applications/Isabelle*` |
| Linux | `/opt/Isabelle*`, `/usr/local/Isabelle*`, `$HOME/Isabelle*` |

### Manual

Otherwise, set `isabelle.executablePath` in Settings (Ctrl+,) — for example:

```
"isabelle.executablePath": "C:\\Program Files\\Isabelle2025\\bin\\isabelle.ps1"
```

On Windows the official launcher is `isabelle.ps1`; the extension wraps it with `powershell.exe -File` automatically.

## After installing

Click **Re-check setup** below and the green tick should appear.
