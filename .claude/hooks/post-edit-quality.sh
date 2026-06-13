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

# Call the project-local binaries directly — `npx` adds ~0.5s of resolution per
# invocation, which dominated the per-edit loop (~2.3s for three `npx` calls).
# Fall back to `npx` only if deps aren't installed (e.g. a fresh clone).
BIN="$PWD/node_modules/.bin"
PRETTIER="$BIN/prettier"; [ -x "$PRETTIER" ] || PRETTIER="npx prettier"
ESLINT="$BIN/eslint";     [ -x "$ESLINT" ]   || ESLINT="npx eslint"
VITEST="$BIN/vitest";     [ -x "$VITEST" ]   || VITEST="npx vitest"

# format + lint only the lint targets
case "$REL" in
  *.ts | *.tsx | *.astro)
    if ! OUT=$($PRETTIER --write "$REL" && $ESLINT --fix "$REL" 2>&1); then
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
        if ! OUT=$($VITEST related "$REL" --run 2>&1); then
          echo "$OUT" >&2
          exit 2
        fi
        ;;
    esac
    ;;
esac

exit 0
