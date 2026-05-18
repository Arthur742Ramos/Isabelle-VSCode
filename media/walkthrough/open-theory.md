# Open a theory

The extension activates on **Isabelle `.thy` files**. Open any existing `.thy` file from disk, or create a new one and paste this minimal example:

```isabelle
theory Hello
  imports Main
begin

definition double :: "nat \<Rightarrow> nat" where
  "double n = 2 * n"

lemma double_zero: "double 0 = 0"
  unfolding double_def
  by simp

end
```

Save it as `Hello.thy` somewhere on disk (the file extension matters — not the location).

## What you should see immediately

- Syntax highlighting on `theory`, `imports`, `definition`, `lemma`, `unfolding`, `by`, …
- New views in the Explorer sidebar: **Isabelle Sessions**, **Isabelle Theory Outline**, **Isabelle Proof Outline**, **Isabelle Proof State**, **Isabelle Sledgehammer**, **Isabelle Theory Graph**.
- A status-bar item at the bottom-left: **Isabelle: no active session** (click to pick one).
- The full set of `Isabelle: …` commands in the Command Palette (Ctrl+Shift+P → type `Isabelle:`).

## Next

Once a `.thy` file is open, this walkthrough step ticks itself off — move on to **Try a build**.
