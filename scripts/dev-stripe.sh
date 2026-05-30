#!/usr/bin/env bash
# Thin wrapper around the Stripe CLI that bypasses the
# symlink-refusal on ~/.config.
#
# The Stripe CLI refuses to write config through a
# symlinked parent directory (security check). If your
# ~/.config is a dotfiles symlink -- a common setup --
# `stripe login` errors out with
# "refusing to write config directory: ~/.config is a
# symlink".
#
# This wrapper resolves the real underlying path and
# passes --config to the Stripe CLI so login / listen /
# whoami all work without a global alias.
#
# Usage: identical to `stripe` itself.
#
#   scripts/dev-stripe.sh login
#   scripts/dev-stripe.sh whoami
#   scripts/dev-stripe.sh listen --forward-to \
#       localhost:3030/billing/webhook/stripe
#   scripts/dev-stripe.sh trigger payment_intent.succeeded \
#       --add payment_intent:metadata.user_id=<uuid> \
#       --add payment_intent:metadata.price_id=$STRIPE_PRICE_TOKEN_PACK_500K
#
# Override the resolved config path with STRIPE_CLI_CONFIG.
set -euo pipefail

if ! command -v stripe >/dev/null 2>&1; then
  echo "stripe CLI not found. Install via:" >&2
  echo "  brew install stripe/stripe-cli/stripe" >&2
  exit 1
fi

# Resolve symlinks in ~/.config so the path passed to the
# Stripe CLI is the real underlying directory.
# Use python3 for cross-platform realpath (macOS BSD
# readlink lacks -f; greadlink isn't always installed).
CONFIG_REAL=$(python3 -c "
import os, sys
print(os.path.realpath(os.path.expanduser('~/.config')))
")

STRIPE_CONFIG="${STRIPE_CLI_CONFIG:-$CONFIG_REAL/stripe/config.toml}"
mkdir -p "$(dirname "$STRIPE_CONFIG")"

# Run as a child (instead of exec) so we can intercept
# Ctrl+C and force-quit on a second press. The Stripe
# CLI's graceful shutdown for `stripe listen` waits for
# in-flight webhook forwards to complete, which can hang
# the terminal for tens of seconds. A second SIGINT
# bypasses that wait and SIGKILLs the child.
stripe --config "$STRIPE_CONFIG" "$@" &
CHILD_PID=$!

FORCED=
handle_sigint() {
  if [ -n "$FORCED" ]; then
    echo "" >&2
    echo "[dev-stripe] force-killing PID $CHILD_PID" >&2
    kill -KILL "$CHILD_PID" 2>/dev/null || true
    exit 130
  fi
  FORCED=1
  echo "" >&2
  echo "[dev-stripe] sending SIGINT to PID $CHILD_PID -- press Ctrl+C again to force-quit" >&2
  kill -INT "$CHILD_PID" 2>/dev/null || true
}
trap handle_sigint INT
trap 'kill -TERM "$CHILD_PID" 2>/dev/null || true' TERM

# wait returns 128+signum if interrupted by signal;
# preserve the child's real exit code on clean shutdown.
wait "$CHILD_PID"
exit $?
