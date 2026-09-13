#!/usr/bin/env bash
# Mint an access token from the local API using the
# credentials at ~/.config/ridingbytes/kaisho.env (or
# $KAISHO_CREDS). Prints the access_token to stdout so it
# composes:
#
#   JWT=$(scripts/dev-login.sh)
#   curl -H "Authorization: Bearer $JWT" ...
#
# The creds file must define EMAIL and PASSWORD. Defaults
# to the local API on :3030 (the bin/dev port); override
# with HOST=...
set -euo pipefail

CREDS="${KAISHO_CREDS:-$HOME/.config/ridingbytes/kaisho.env}"
HOST="${HOST:-http://localhost:3030}"

if [ ! -f "$CREDS" ]; then
  echo "Credentials file not found: $CREDS" >&2
  exit 1
fi

# shellcheck disable=SC1090
. "$CREDS"

if [ -z "${EMAIL:-}" ] || [ -z "${PASSWORD:-}" ]; then
  echo "EMAIL or PASSWORD missing in $CREDS" >&2
  exit 1
fi

# Build the request body, post, and extract the token in a
# single Python pass. Avoids JSON-escaping the password by
# hand and keeps the whole script free of jq.
EMAIL="$EMAIL" PASSWORD="$PASSWORD" HOST="$HOST" \
  python3 - <<'PY'
import json
import os
import sys
import urllib.error
import urllib.request

payload = json.dumps({
    "email": os.environ["EMAIL"],
    "password": os.environ["PASSWORD"],
}).encode()

req = urllib.request.Request(
    f"{os.environ['HOST']}/auth/login",
    data=payload,
    headers={"Content-Type": "application/json"},
)

try:
    body = urllib.request.urlopen(req, timeout=10).read()
except urllib.error.HTTPError as exc:
    sys.stderr.write(
        f"Login failed ({exc.code}): "
        f"{exc.read().decode(errors='replace')}\n"
    )
    sys.exit(1)
except urllib.error.URLError as exc:
    sys.stderr.write(f"Could not reach {os.environ['HOST']}: {exc}\n")
    sys.exit(1)

token = json.loads(body).get("access_token", "")
if not token:
    sys.stderr.write(f"No access_token in response: {body!r}\n")
    sys.exit(1)

print(token)
PY
