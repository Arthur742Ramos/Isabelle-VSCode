---
name: address-pr-review-comments
description: Respond to inline review threads on an open or merged PR — evaluate each, fix what's actionable, reply, and resolve via GraphQL.
when-to-use: When a reviewer (human or automated, e.g. copilot-pull-request-reviewer) leaves inline comments on a PR. This skill walks the full reply-and-resolve loop and includes the Windows-specific fallback when the built-in helper script trips on Git Bash path mangling.
---

# Address inline PR review comments

Inline review threads on a PR each need three things to be considered handled:

1. **Substantive evaluation** — the comment may be a real bug, a non-issue, or a style preference. Decide on the merits.
2. **Action** — if actionable, make the change and push.
3. **Reply + resolve** — a public reply on the thread (so future reviewers can see the disposition) followed by **resolving** the thread via GitHub's GraphQL `resolveReviewThread` mutation. A thread is not closed-out until it's resolved.

## Steps

### 1. Fetch unresolved threads

```powershell
$env:GH_PAGER=""
gh api graphql -f query='
{ repository(owner: "<owner>", name: "<repo>") {
  pullRequest(number: <pr>) {
    reviewThreads(first: 100) { nodes {
      isResolved id path line
      comments(last: 1) { nodes { databaseId body author { login } } }
    } }
  }
} }' --jq '[.data.repository.pullRequest.reviewThreads.nodes[]
  | select(.isResolved == false)
  | {threadId: .id, path, line, latestCommentDatabaseId: .comments.nodes[0].databaseId, body: .comments.nodes[0].body}]'
```

The output is an array of unresolved threads. Capture each thread's `threadId` (GraphQL node ID, format `PRRT_…`) and `latestCommentDatabaseId` (numeric REST ID) — you need both for the reply + resolve step.

### 2. Evaluate each thread on its merits

For each comment, decide:

| Verdict | Action |
|---|---|
| **Actionable, you agree** | Make the change, commit, push, reply explaining the fix, resolve. |
| **Actionable, you disagree about the approach** | Reply explaining your reasoning. Optionally make an alternative fix. Resolve if the reviewer agrees. |
| **Inapplicable** (comment about deleted code, factually wrong, already addressed) | Reply explaining why, resolve. |
| **Genuinely uncertain** | Escalate to a human via `ask_user` (Copilot CLI) or by leaving the thread open and pinging in the PR body. |

Do not auto-resolve threads without engaging — the reply is part of the contract.

### 3. Make the fix (if needed)

Commit the fix on a follow-up PR branch — usually `<your-handle>/pr<NN>-review-followups` is a good name. Push the branch and either open a follow-up PR or, if the original PR is still open, push directly to its branch.

The fix commit should:

- Use a conventional-commit subject naming the issue concisely (`fix(setup): address PR #60 review comments`).
- Reference the comment numbers / file paths in the body so it's traceable.
- Add tests covering the regression if applicable. (See [`AGENTS.md`](../AGENTS.md) "Test conventions" — structural / vscode-free.)
- Include the Copilot `Co-authored-by` trailer when an agent is co-authoring.

### 4. Reply + resolve

Per thread:

```powershell
$env:GH_PAGER=""

# 4a. Post the reply via the REST endpoint /repos/{owner}/{repo}/pulls/{pr}/comments/{cid}/replies
$tmpJson = New-TemporaryFile
@{ body = "Your reply text. Reference the follow-up PR / commit if applicable." } |
  ConvertTo-Json -Compress |
  Set-Content -Path $tmpJson -NoNewline -Encoding utf8
gh api -X POST "repos/<owner>/<repo>/pulls/<pr>/comments/<cid>/replies" --input $tmpJson
Remove-Item $tmpJson

# 4b. Resolve the thread via GraphQL
gh api graphql `
  -f query='mutation($threadId: ID!) { resolveReviewThread(input: {threadId: $threadId}) { thread { id isResolved } } }' `
  -F threadId="<threadId>"
```

After this both calls succeed for a thread, it's considered handled.

## Windows gotcha — Git Bash path mangling

The repository ships a helper script for reply-and-resolve, but on Windows under Git Bash MSYS (which is what `bash` resolves to on a default `gh`/`git` install) the leading slash in `/repos/...` gets rewritten to a Windows filesystem path, breaking the API call:

```
invalid API endpoint: "C:/Program Files/Git/repos/<owner>/<repo>/pulls/<pr>/..."
Your shell might be rewriting URL paths as filesystem paths.
```

**Workaround:** invoke `gh api` directly from PowerShell — it doesn't suffer the path-mangling — using the two-step pattern above (POST reply, then GraphQL resolve). This is what's coded in the `skills/address-pr-review-comments.md` skill and what was used in PR #61 to resolve all 8 threads on PR #60.

If you're on macOS or Linux, the original helper script works fine.

## Verification

After processing all threads:

```powershell
$env:GH_PAGER=""
gh api graphql -f query='
{ repository(owner: "<owner>", name: "<repo>") {
  pullRequest(number: <pr>) {
    reviewThreads(first: 100) { nodes { isResolved id } }
  }
} }' --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | {tid: .id, resolved: .isResolved}]'
```

Every entry should show `"resolved": true`. If any remain `false`, run the reply+resolve pair for those threads again.

## When the original PR is already merged

You can still address review comments after merge — open a follow-up PR with the fixes, then reply to each thread on the merged PR linking to the follow-up. The threads can still be resolved on a merged PR. This pattern is what PR #61 did for PR #60's 8 outstanding comments.

## What this skill does NOT cover

- **Top-level review bodies** (summary attached to a `COMMENTED`/`CHANGES_REQUESTED` review) — those cannot be resolved via the API. Read them, action anything useful, and optionally reply if it would clarify your response.
- **Top-level PR comments** (issue-style comments on the PR conversation) — also cannot be resolved. Same treatment as review bodies.
- **Resolving threads someone else opened on a PR you didn't author** — you can do this if you have write access, but be conservative; usually the original author or reviewer should resolve.
