(*  Smoke theory for end-to-end manual verification of the
    Isabelle PIDE VS Code extension.

    This file is intentionally tiny so a contributor can use it to
    walk through every Tier-2 LSP-mode capability the extension
    advertises, without needing an existing Isabelle project on disk.

    See `docs/SMOKE_THEORY_CHECKLIST.md` for the full step-by-step
    checklist this theory is designed to exercise. *)

theory Smoke
  imports Main
begin

text \<open>
  Section 1: a trivial lemma that Sledgehammer should crack in
  one shot. Place the cursor on the @{command sorry} below and run
  \<open>Isabelle: Run Sledgehammer\<close> to verify the LSP-backed Sledgehammer
  panel surfaces \<open>blast\<close>- / \<open>metis\<close>-class suggestions.
\<close>

lemma conj_commute_smoke:
  assumes "A \<and> B"
  shows "B \<and> A"
  sorry

text \<open>
  Section 2: a finished proof to exercise the proof state panel.
  Move the cursor through the proof and watch the panel refresh.
\<close>

lemma add_zero_right_smoke:
  fixes n :: nat
  shows "n + 0 = n"
  by simp

text \<open>
  Section 3: a deliberately broken lemma to exercise the LSP
  PublishDiagnostics surface AND the CLI-build diagnostics surface.

  Uncomment the body and confirm:
    * Problems panel shows an LSP-side diagnostic on the wrong
      conclusion.
    * \<open>Isabelle: Build Active Session\<close> populates a separate
      \<open>isabelle-build\<close> diagnostic with the same root cause.

  Both should coexist, not overwrite each other.
\<close>

(*
lemma deliberately_broken_smoke:
  shows "(1 :: nat) = 2"
  by simp
*)

text \<open>
  Section 4: an abbreviation exercise. Delete the \<open>\<lambda>\<close>
  below and re-type \<open>\\<close>, \<open>l\<close>, \<open>a\<close>, \<open>m\<close>, \<open>b\<close>, \<open>d\<close>, \<open>a\<close>,
  \<open>>\<close>. The Isabelle abbreviation completion should offer the
  Unicode \<open>\<lambda>\<close> from the cached PIDE/abbrevs_response table.
\<close>

definition identity_smoke :: "'a \<Rightarrow> 'a" where
  "identity_smoke = (\<lambda>x. x)"

end
