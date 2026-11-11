#!/usr/bin/env bash
# Asks the Codex agent to bring .agents/ in line with .claude/ (the canonical copy),
# then checks the result itself. Run from anywhere inside the repo:
#
#   bash scripts/sync-agents.sh
#
# This starts a headless Codex run (`codex exec`) whose only writable folder is
# .agents. It cannot type into a Codex session that is already open in another
# terminal: no such channel exists.
set -euo pipefail

root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$root"

if ! command -v codex >/dev/null 2>&1; then
  echo "codex CLI not found on PATH. Install it or run the sync by hand." >&2
  exit 127
fi

# Only these are mirrored. Everything else in .claude/ (settings, local files) stays put.
paths=(AGENTS.md docs SKILLS)

differences() {
  local p
  for p in "${paths[@]}"; do
    diff -rq ".claude/$p" ".agents/$p" 2>&1 || true
  done
}

before="$(differences)"
if [ -z "$before" ]; then
  echo ".agents already matches .claude. Nothing to do."
  exit 0
fi

echo "Out of sync:"
echo "$before"
echo
echo "Asking Codex to sync..."

# Codex runs with .agents as its workspace, so its sandbox lets it write there
# and nowhere else in the repository. It can still read ../.claude.
codex exec --cd "$root/.agents" --sandbox workspace-write --ephemeral   -c 'sandbox_workspace_write.exclude_tmpdir_env_var=true'   -c 'sandbox_workspace_write.exclude_slash_tmp=true' - <<PROMPT
Your working directory is the .agents folder of a repository. Update the files here so they
exactly match the files in ../.claude, which is the canonical copy.

Scope: only ../.claude/AGENTS.md, ../.claude/docs/ and ../.claude/SKILLS/, mirrored to
./AGENTS.md, ./docs/ and ./SKILLS/.

Rules:
- Make each file here byte-for-byte identical to its ../.claude counterpart. Copy files; do not
  rewrite, summarise, reformat or "improve" any content.
- Create files that exist only under ../.claude. Delete files in ./docs and ./SKILLS that have
  no ../.claude counterpart.
- You can only write inside this folder. Do not try to change anything outside it.
- Do not commit, stage or push.

These currently differ (paths relative to the repository root):
$before

When done, list the files you changed in one short line each.
PROMPT

after="$(differences)"
if [ -n "$after" ]; then
  echo
  echo "Codex finished, but .agents still differs from .claude:" >&2
  echo "$after" >&2
  exit 1
fi
echo
echo ".agents now matches .claude."
