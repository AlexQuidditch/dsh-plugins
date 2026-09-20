#!/usr/bin/env bash
# verify-header.sh — authoritative route verification for DSH session journals.
#
# The first `request/header` event of a session journal is the ground truth
# about which provider/model/effort a request actually used (model
# self-reports are unreliable). Journals are zstd-compressed JSONL under
# ~/.dsh/sessions/<workspace-slug>/<sessionId>/session.v3.jsonl.zstd.
#
# Usage:
#   verify-header.sh list                 newest session ids of the workspace
#   verify-header.sh first <sessionId>    first request header of a session
#   verify-header.sh all <sessionId>      every request header of a session
#
# Environment:
#   WORKSPACE_SLUG  path slug of the workspace directory
#                   (default: the dsh-plugins repository slug)
set -euo pipefail

SLUG_DEFAULT='--Users-alex-quidditch-projects-dsh-plugins--'
SESS="${DSH_HOME:-$HOME/.dsh}/sessions/${WORKSPACE_SLUG:-$SLUG_DEFAULT}"

command -v zstdcat >/dev/null 2>&1 || { echo 'zstdcat not found (brew install zstd)' >&2; exit 1; }

hdrs() {
  zstdcat "$SESS/$1/session.v3.jsonl.zstd" 2>/dev/null | python3 -c '
import json, sys
which = sys.argv[1]
n = 0
for line in sys.stdin:
    try:
        e = json.loads(line)
    except Exception:
        continue
    if e.get("type") != "request/header":
        continue
    n += 1
    if which == "first":
        pass
    c = e["data"]["header"]["config"]
    reason = e["data"].get("reason", "")
    print(f"header #{n} [{reason}]: {c.get('provider')}/{c.get('model')}/{c.get('reasoningEffort')}")
    if which == "first":
        break
' "$2"
}

case "${1:-list}" in
  list)
    ls -t "$SESS" | head -30
    ;;
  first)
    [ -n "${2:-}" ] || { echo 'usage: verify-header.sh first <sessionId>' >&2; exit 1; }
    hdrs "$2" first
    ;;
  all)
    [ -n "${2:-}" ] || { echo 'usage: verify-header.sh all <sessionId>' >&2; exit 1; }
    hdrs "$2" all
    ;;
  *)
    echo "unknown command: $1 (use list | first | all)" >&2
    exit 1
    ;;
esac
