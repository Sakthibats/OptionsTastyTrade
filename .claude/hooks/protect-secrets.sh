#!/usr/bin/env bash
# PreToolUse hook: refuse any tool call that touches a secrets file.
#
# Defense-in-depth on top of permissions.deny and sandbox.filesystem.denyRead in
# .claude/settings.json. It is a string match, not a security boundary: an
# obfuscated command (globs, base64, variables) can slip past it. The sandbox is
# what enforces reads at the OS level; this hook catches the common cases and
# tells Claude why it was stopped.
#
# Exit 2 = block the tool call and show stderr to Claude.

input="$(cat)"

# Collect the fields that can name a file or carry a shell command.
if command -v jq >/dev/null 2>&1; then
  subject="$(printf '%s' "$input" | jq -r '
    [.tool_input.command, .tool_input.file_path, .tool_input.path,
     .tool_input.notebook_path, .tool_input.pattern, .tool_input.glob]
    | map(select(. != null)) | join("\n")' 2>/dev/null)" || subject="$input"
else
  subject="$input"
fi

# The committed template is fine to read and edit.
subject="${subject//.env.example/}"

# .env, ./.env, path/.env, .env.local, .env.production, ... and wrangler's .dev.vars.
# The leading [^A-Za-z0-9_] keeps code like process.env / import.meta.env from matching.
if printf '%s' "$subject" | grep -Eq '(^|[^A-Za-z0-9_])\.env($|[^A-Za-z0-9_])|(^|[^A-Za-z0-9_])\.env\.[A-Za-z]|\.dev\.vars'; then
  cat >&2 <<'MSG'
Blocked by .claude/hooks/protect-secrets.sh: this tool call references a secrets file
(.env, .env.*, or .dev.vars). Claude must not read, print, copy, grep, or edit secrets.
Variable names are in worker/env.ts. If something really needs the secret file, ask
the user to run that step themselves.
MSG
  exit 2
fi

exit 0
