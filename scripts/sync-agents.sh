#!/usr/bin/env bash
# Opens a new terminal window running a Codex agent that brings .agents/ in line with
# .claude/ (the canonical copy), then checks the result before anything reaches .agents/.
# Works in any project with a .claude folder. Run from anywhere inside the project:
#
#   bash scripts/sync-agents.sh
#
# Containment:
#   - Codex never works in the repository. It runs in a temporary workspace holding
#       canonical/  a read-only copy of the mirrored parts of .claude/
#       agents/     a writable copy of the same parts of .agents/ (Codex's working root)
#   - Codex's workspace-write sandbox lets it write only inside agents/ (temp dirs excluded).
#   - This script copies agents/ back into .agents/ only after it matches .claude/ exactly.
#   - Codex's sandbox does not block reads elsewhere on disk. The workspace and the prompt
#     keep it to canonical/, but this is not an OS-level read restriction.
#
# The first thing it does is a plain `diff -rq` of the mirrored paths. If nothing differs it
# exits at once, without starting Codex or opening a window.
#
# Environment overrides:
#   SYNC_EXCLUDE="CLAUDE.md settings*.json"  top-level names in .claude not to mirror
#                             (default: CLAUDE.md CLAUDE.local.md settings.json
#                             settings.local.json *.local.* worktrees; "" mirrors everything)
#   SYNC_PATHS="docs skills"  mirror only these paths (overrides SYNC_EXCLUDE)
#   SYNC_TERMINAL=wt|mintty|cmd|macos|gnome|konsole|xterm   force one terminal launcher
#   SYNC_START_TIMEOUT=30     seconds to wait for the new terminal to start the agent
#   SYNC_TIMEOUT=900          seconds to wait for the agent to finish
#   SYNC_KEEP_WORKSPACE=1     keep the temporary workspace for debugging
set -euo pipefail

fail() {
  echo "sync-agents: $1" >&2
  shift
  local line
  for line in "$@"; do echo "  $line" >&2; done
  exit 1
}

# Project root: the git top level of the current directory, else the current directory.
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$root"
[ -d .claude ] || fail "no .claude folder in $root." \
  "Run this script from the root of a project that has a .claude folder."

# What gets mirrored: every top-level file and folder in .claude, hidden ones included,
# except names matching SYNC_EXCLUDE (case-insensitive globs). The default exclusions are
# Claude-only files: CLAUDE.md is .claude's own entry point (.agents uses AGENTS.md), and
# settings and *.local.* files are machine- or tool-specific.
# SYNC_PATHS="docs skills" mirrors only the listed paths instead.
default_exclude='CLAUDE.md CLAUDE.local.md settings.json settings.local.json *.local.* worktrees'
if [ -n "${SYNC_PATHS:-}" ]; then
  read -r -a paths <<<"$SYNC_PATHS"
else
  read -r -a excludes <<<"${SYNC_EXCLUDE-$default_exclude}"
  shopt -s dotglob nullglob nocasematch
  paths=()
  for entry in .claude/*; do
    name="${entry#.claude/}"
    skip=0
    for pattern in "${excludes[@]}"; do
      # shellcheck disable=SC2053  # $pattern is a glob on purpose
      [[ "$name" == $pattern ]] && { skip=1; break; }
    done
    [ "$skip" = 0 ] && paths+=("$name")
  done
  shopt -u dotglob nullglob nocasematch
fi
[ "${#paths[@]}" -gt 0 ] || fail "nothing to mirror: every entry in .claude is excluded." \
  "Check SYNC_EXCLUDE, or set SYNC_PATHS to the folders and files you want mirrored."

# ---------------------------------------------------------------- preflight

for p in "${paths[@]}"; do
  [ -e ".claude/$p" ] || fail "canonical path .claude/$p is missing; nothing to sync from."
done
mkdir -p .agents

differences() { # $1 = canonical dir, $2 = mirror dir
  local p
  for p in "${paths[@]}"; do
    diff -rq "$1/$p" "$2/$p" 2>&1 || true
  done
}

before="$(differences .claude .agents)"
if [ -z "$before" ]; then
  echo ".agents already matches .claude. Nothing to do."
  exit 0
fi

echo "Out of sync:"
echo "$before"
echo

# Codex checks come after the comparison so the common "already in sync" case stays instant.
command -v codex >/dev/null 2>&1 \
  || fail "codex CLI not found on PATH." "Install it with: npm install -g @openai/codex"

codex login status >/dev/null 2>&1 \
  || fail "codex is not logged in." "Run: codex login"

# ---------------------------------------------------------------- workspace

work="$(mktemp -d 2>/dev/null)" || fail "could not create a temporary workspace (mktemp -d failed)."
cleanup() {
  if [ "${SYNC_KEEP_WORKSPACE:-0}" = 1 ]; then
    echo "Workspace kept at: $work"
  else
    chmod -R u+w "$work" 2>/dev/null || true
    rm -rf "$work"
  fi
}
trap cleanup EXIT

mkdir -p "$work/canonical" "$work/agents"
for p in "${paths[@]}"; do
  cp -R ".claude/$p" "$work/canonical/$p"
  [ -e ".agents/$p" ] && cp -R ".agents/$p" "$work/agents/$p"
done
chmod -R a-w "$work/canonical"

# Native-style paths (C:/...) so any launched shell resolves them the same way.
to_native() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
work_n="$(to_native "$work")"

cat >"$work/prompt.txt" <<PROMPT
Your working directory is a folder of agent instructions. Update the files here so they
exactly match the files in ../canonical, which is the canonical copy.

Scope: only these paths, mirrored from ../canonical/<path> to ./<path>: ${paths[*]}

Rules:
- Make each file here byte-for-byte identical to its ../canonical counterpart. Copy files; do not
  rewrite, summarise, reformat or "improve" any content.
- Create files that exist only under ../canonical. Delete files in the scoped paths here that
  have no ../canonical counterpart.
- Read only ./ and ../canonical. Do not read or write anything else.
- You can only write inside this folder. Do not try to change anything outside it.
- Do not use git.

These currently differ:
$before

When done, list the files you changed in one short line each.
PROMPT

# The runner is what the new terminal executes. It records that it started, its PID,
# the agent's log and exit code, so this script can tell what happened.
q() { printf '%q' "$1"; }
cat >"$work/runner.sh" <<RUNNER
#!/usr/bin/env bash
export PATH=$(q "$PATH")
echo \$\$ > $(q "$work_n/runner.pid")
touch $(q "$work_n/started")
echo "Codex sync agent (writes confined to $(q "$work_n/agents"))"
echo
set -o pipefail
codex exec --cd $(q "$work_n/agents") --sandbox workspace-write --ephemeral --skip-git-repo-check \\
  -c 'sandbox_workspace_write.exclude_tmpdir_env_var=true' \\
  -c 'sandbox_workspace_write.exclude_slash_tmp=true' \\
  -c 'sandbox_workspace_write.network_access=false' \\
  - < $(q "$work_n/prompt.txt") 2>&1 | tee $(q "$work_n/codex.log")
code=\$?
echo \$code > $(q "$work_n/exit-code")
echo
echo "Codex exited with code \$code. The original terminal is checking the result."
read -r -p "Press Enter to close this window. " _ || true
RUNNER

# ---------------------------------------------------------------- terminal

bash_path="$(command -v bash)"
bash_n="$(to_native "$bash_path")"
if command -v cygpath >/dev/null 2>&1; then bash_w="$(cygpath -w "$bash_path")"; else bash_w="$bash_path"; fi
runner_n="$work_n/runner.sh"
title="Codex: sync .agents"
launch_errors=()

try_launch() { # $1 = name; remaining args = command
  local name="$1" out
  shift
  if out="$("$@" 2>&1)"; then
    echo "Opened a new terminal with $name."
    return 0
  fi
  launch_errors+=("$name: ${out:-exited non-zero with no output}")
  return 1
}

launch() { # $1 = launcher name
  case "$1" in
    wt)      command -v wt.exe >/dev/null 2>&1 || { launch_errors+=("wt: wt.exe not found"); return 1; }
             try_launch "Windows Terminal" wt.exe -w new --title "$title" "$bash_w" "$runner_n" ;;
    mintty)  command -v mintty >/dev/null 2>&1 || { launch_errors+=("mintty: not found"); return 1; }
             # mintty stays attached to its window, so start it in the background.
             (mintty -t "$title" -e "$bash_n" "$runner_n" >/dev/null 2>&1 &) \
               && echo "Opened a new terminal with mintty." ;;
    cmd)     command -v cmd.exe >/dev/null 2>&1 || { launch_errors+=("cmd: cmd.exe not found"); return 1; }
             try_launch "a console window" cmd.exe //c start "\"$title\"" "$bash_w" "$runner_n" ;;
    macos)   command -v osascript >/dev/null 2>&1 || { launch_errors+=("macos: osascript not found"); return 1; }
             try_launch "Terminal.app" osascript -e "tell application \"Terminal\" to do script \"bash $(q "$runner_n")\"" ;;
    gnome)   command -v gnome-terminal >/dev/null 2>&1 || { launch_errors+=("gnome: gnome-terminal not found"); return 1; }
             try_launch "gnome-terminal" gnome-terminal --title "$title" -- bash "$runner_n" ;;
    konsole) command -v konsole >/dev/null 2>&1 || { launch_errors+=("konsole: not found"); return 1; }
             (konsole -e bash "$runner_n" >/dev/null 2>&1 &) && echo "Opened a new terminal with konsole." ;;
    xterm)   command -v xterm >/dev/null 2>&1 || { launch_errors+=("xterm: not found"); return 1; }
             (xterm -T "$title" -e bash "$runner_n" >/dev/null 2>&1 &) && echo "Opened a new terminal with xterm." ;;
    *)       launch_errors+=("$1: unknown launcher name"); return 1 ;;
  esac
}

if [ -n "${SYNC_TERMINAL:-}" ]; then
  candidates=("$SYNC_TERMINAL")
else
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) candidates=(wt mintty cmd) ;;
    Darwin)               candidates=(macos) ;;
    *)                    candidates=(gnome konsole xterm) ;;
  esac
fi

launched=0
for c in "${candidates[@]}"; do
  if launch "$c"; then launched=1; break; fi
done
[ "$launched" = 1 ] || fail "could not open a new terminal for the Codex agent. Tried:" \
  "${launch_errors[@]}" "Set SYNC_TERMINAL to pick a launcher that works on this machine."

# ---------------------------------------------------------------- wait

start_timeout="${SYNC_START_TIMEOUT:-30}"
waited=0
until [ -f "$work/started" ]; do
  [ "$waited" -ge "$start_timeout" ] && fail "the terminal opened but the agent never started (${start_timeout}s)." \
    "The window may have closed straight away, or the launcher could not run bash." \
    "Try another launcher, e.g. SYNC_TERMINAL=mintty, or rerun with SYNC_KEEP_WORKSPACE=1 and run:" \
    "bash $runner_n"
  sleep 1
  waited=$((waited + 1))
done
echo "Agent started. Waiting for it to finish (watch the new window)..."

timeout="${SYNC_TIMEOUT:-900}"
waited=0
until [ -f "$work/exit-code" ]; do
  pid="$(cat "$work/runner.pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null && [ ! -f "$work/exit-code" ]; then
    fail "the agent's terminal closed before Codex finished. .agents was not changed."
  fi
  [ "$waited" -ge "$timeout" ] && fail "the agent did not finish within ${timeout}s. .agents was not changed." \
    "Close its window, or raise SYNC_TIMEOUT."
  sleep 2
  waited=$((waited + 2))
done

code="$(cat "$work/exit-code")"
if [ "$code" != 0 ]; then
  echo "Last lines of the Codex log:" >&2
  tail -n 20 "$work/codex.log" >&2 2>/dev/null || true
  fail "codex exited with code $code. .agents was not changed."
fi

# ---------------------------------------------------------------- verify and apply

[ -z "$(differences .claude "$work/canonical")" ] \
  || fail "the read-only canonical copy was modified during the run. .agents was not changed."

remaining="$(differences "$work/canonical" "$work/agents")"
[ -z "$remaining" ] || fail "Codex finished, but its copy still differs from .claude. .agents was not changed." \
  "$remaining"

# Files copied from the read-only canonical copy come back read-only; undo that.
chmod -R u+w "$work/agents"
for p in "${paths[@]}"; do
  rm -rf ".agents/$p"
  cp -R "$work/agents/$p" ".agents/$p"
done

after="$(differences .claude .agents)"
[ -z "$after" ] || fail "copying the agent's result into .agents failed; it still differs:" "$after"

echo
echo ".agents now matches .claude."
