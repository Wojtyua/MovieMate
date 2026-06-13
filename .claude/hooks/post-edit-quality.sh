#!/usr/bin/env bash
# Per-edit agent quality hook (Claude Code PostToolUse, matcher Write|Edit).
# Reads the edited file path from the hook's stdin JSON, formats + lints it when
# it is a lint target, and runs the scoped Vitest suite when the path is under a
# test-plan §2 risk area. On any check failure, prints the output to stderr and
# exits 2 (the channel Claude Code surfaces to the agent); otherwise exits 0.
set -uo pipefail

FILE=$(jq -r '.tool_input.file_path // empty')
[ -z "$FILE" ] || [ ! -f "$FILE" ] && exit 0
REL=${FILE#"$PWD"/}

# format + lint only the lint targets
case "$REL" in
  *.ts | *.tsx | *.astro)
    if ! OUT=$(npx prettier --write "$REL" && npx eslint --fix "$REL" 2>&1); then
      echo "$OUT" >&2
      exit 2
    fi
    ;;
esac

# scoped tests only for ts/tsx under a §2 risk area
case "$REL" in
  src/lib/recommend/* | src/pages/api/* | src/pages/sessions/* | src/components/sessions/* | src/middleware.ts)
    case "$REL" in
      *.ts | *.tsx)
        if ! OUT=$(npx vitest related "$REL" --run 2>&1); then
          echo "$OUT" >&2
          exit 2
        fi
        ;;
    esac
    ;;
esac

exit 0
