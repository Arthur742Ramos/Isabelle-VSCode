# Security policy

## Supported versions

The current alpha line is supported on a best-effort basis. Security fixes land
on `main` first and are included in the next tagged alpha or stable release.

## Reporting a vulnerability

Use GitHub private vulnerability reporting for this repository if it is
available. If it is not available, open a public issue that says you need to
report a vulnerability, but do **not** include exploit details, secrets, private
code, or proprietary Isabelle theories in that issue.

## Security-relevant behavior

- The extension launches local `java` and `isabelle` processes using the
  configured executable paths. Report path-handling bugs that could execute an
  unintended binary.
- The checked AI repair seam is default-deny. It does not call a third-party
  provider unless `isabelle.repair.aiProvider` is configured,
  `isabelle.repair.aiAcknowledgedSharing` is `true`, and the pre-send review is
  confirmed.
- AI repair requests may include source code, diagnostics, file paths, and proof
  state. Do not attach real repair bundles to public issues unless the content
  is already public.
- Provider secrets are stored with VS Code `SecretStorage` under provider-scoped
  keys; never put AI provider credentials in workspace settings or issue logs.
