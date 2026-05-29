#!/usr/bin/env bash
# Mint a JWT and create a Stripe checkout session against the
# local API. Saves the "log in then curl" boilerplate for
# manual sandbox tests.
#
# Usage:
#   scripts/dev-checkout.sh                 # token pack (default)
#   scripts/dev-checkout.sh tokens          # same
#   scripts/dev-checkout.sh companion       # monthly companion
#   scripts/dev-checkout.sh companion -y    # yearly companion
#   scripts/dev-checkout.sh pro             # monthly pro
#   scripts/dev-checkout.sh pro -y          # yearly pro
#   scripts/dev-checkout.sh team            # monthly team
#
# Options:
#   -o, --open      Also open the checkout URL in the default
#                   browser (macOS: open, Linux: xdg-open).
#   -y, --yearly    For subscription plans, pick the yearly
#                   price instead of monthly.
#   -h, --help      Show this message.
#
# Env:
#   HOST            Override the API host (default
#                   http://localhost:3030 -- inherited from
#                   dev-login.sh).
#   KAISHO_CREDS    Override path to the EMAIL/PASSWORD file
#                   (default ~/.config/ridingbytes/kaisho.env).
set -euo pipefail

PLAN="tokens"
YEARLY=false
OPEN=false

while [ $# -gt 0 ]; do
  case "$1" in
    tokens|token|token-pack)     PLAN="tokens";  shift ;;
    companion|pro|team)          PLAN="$1";      shift ;;
    -y|--yearly)                 YEARLY=true;    shift ;;
    -o|--open)                   OPEN=true;      shift ;;
    -h|--help)
      awk '/^# =|^set -|^[A-Z]+=/{exit}/^#/{sub(/^# ?/,"");print}' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
done

DIR="$(cd "$(dirname "$0")" && pwd)"
HOST="${HOST:-http://localhost:3030}"

# Mint a JWT via the sibling helper. Inherits HOST + creds.
JWT=$(HOST="$HOST" "$DIR/dev-login.sh") || {
  echo "Could not mint JWT. Is the local API up at $HOST?" >&2
  exit 1
}

if [ "$PLAN" = "tokens" ]; then
  ENDPOINT="/billing/token-pack"
  BODY="{}"
  LABEL="token pack (500k)"
else
  ENDPOINT="/billing/checkout"
  Y_FLAG=$([ "$YEARLY" = true ] && echo "true" || echo "false")
  BODY="{\"plan\":\"$PLAN\",\"yearly\":$Y_FLAG}"
  if [ "$YEARLY" = true ]; then
    LABEL="$PLAN (yearly)"
  else
    LABEL="$PLAN (monthly)"
  fi
fi

echo "Creating $LABEL checkout via $HOST$ENDPOINT ..." >&2

RESP=$(curl -sS -X POST "$HOST$ENDPOINT" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "$BODY") || {
  echo "checkout request failed" >&2
  exit 1
}

URL=$(printf "%s" "$RESP" | python3 -c "
import json, sys
try:
    d = json.loads(sys.stdin.read())
except Exception as exc:
    sys.stderr.write(f'response was not JSON: {exc}\n')
    sys.exit(1)
if 'error' in d:
    sys.stderr.write(f'API error: {d[\"error\"]}\n')
    sys.exit(1)
url = d.get('url')
if not url:
    sys.stderr.write(f'no url in response: {d}\n')
    sys.exit(1)
print(url)
")

echo "$URL"

if [ "$OPEN" = true ]; then
  if command -v open >/dev/null 2>&1; then
    open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL"
  else
    echo "no 'open' or 'xdg-open' found; URL printed above" >&2
  fi
fi
