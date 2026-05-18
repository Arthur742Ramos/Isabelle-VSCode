# Third-party notices

The `isabelle-pide-vscode` Visual Studio Code extension is itself MIT-licensed
(see [`LICENSE`](LICENSE)). The notices below cover third-party components
that may be redistributed alongside the extension in some build channels.

## Eclipse Temurin 21 (bundled with per-platform `.vsix`)

Per-platform Visual Studio Marketplace / GitHub Release `.vsix` packages
(e.g. `isabelle-pide-vscode-<version>-win32-x64.vsix`) embed an **Eclipse
Temurin 21 JRE** under `extension/jre/` so end users do not need a system
Java install. The universal `.vsix` (`isabelle-pide-vscode-<version>.vsix`)
does **not** bundle a JRE and continues to require a `java` 21+ on `PATH`.

Eclipse Temurin is published by the Eclipse Adoptium project under the
**GNU General Public License, version 2, with the Classpath Exception**
(GPL-2.0-with-classpath-exception).

The full license text and per-component notices ship inside the bundled JRE
itself:

| Platform | License location inside the installed extension |
| --- | --- |
| Linux / Windows | `extension/jre/legal/`, `extension/jre/LICENSE`, `extension/jre/NOTICE`, `extension/jre/release` |
| macOS           | `extension/jre/Contents/Home/legal/`, `extension/jre/Contents/Home/LICENSE`, `extension/jre/Contents/Home/NOTICE`, `extension/jre/Contents/Home/release` |

To inspect them without installing the extension, download the per-platform
`.vsix`, rename it to `.zip`, and extract the `extension/jre/legal/`
directory. The same files are mirrored verbatim in the upstream Eclipse
Temurin release artifacts hosted at
<https://adoptium.net/temurin/releases/?version=21>.

## OpenJDK / GPL Classpath Exception summary

The Classpath Exception permits unmodified linking of independent modules
(such as the Scala fat jar this extension ships) against the GPL-2.0
licensed runtime without those modules themselves being subject to the GPL.
The exception text is included in the bundled `legal/` directory.

## VS Code extension dependencies

`vscode-languageclient` and the other npm packages listed in
[`package.json`](package.json) ship under their own (MIT-compatible)
licenses; their notices are bundled inline in the esbuild artifact under
`extension/out/extension.js`.
