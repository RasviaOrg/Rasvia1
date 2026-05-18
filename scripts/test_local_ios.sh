#!/bin/bash
set -e

# Always operate from the repo root — see build_and_submit_ios.sh for why.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ── Device selection ──────────────────────────────────────────────────────
# Usage:
#   ./scripts/test_local_ios.sh              → interactive picker
#   ./scripts/test_local_ios.sh iphone       → iPhone 17 Pro
#   ./scripts/test_local_ios.sh ipad         → iPad Pro 13-inch (M5)
#   ./scripts/test_local_ios.sh ipad-mini    → iPad mini (A17 Pro)
#   ./scripts/test_local_ios.sh ipad-air     → iPad Air 13-inch (M3)
#   ./scripts/test_local_ios.sh ipad-11      → iPad Pro 11-inch (M5)

DEVICE=""
ARG="${1:-}"

case "$ARG" in
  iphone)
    DEVICE="iPhone 17 Pro"
    ;;
  ipad|ipad-pro)
    DEVICE="iPad Pro 13-inch (M5)"
    ;;
  ipad-11)
    DEVICE="iPad Pro 11-inch (M5)"
    ;;
  ipad-mini)
    DEVICE="iPad mini (A17 Pro)"
    ;;
  ipad-air)
    DEVICE="iPad Air 13-inch (M3)"
    ;;
  "")
    # Interactive picker — show available simulators and let the user choose
    echo "Available simulators:"
    echo ""
    # Build a numbered list of iPhone + iPad simulators
    mapfile -t SIMS < <(xcrun simctl list devices available 2>/dev/null \
      | grep -E "iPhone|iPad" | grep -v "unavailable" \
      | sed 's/ (.*)//' | sed 's/^[[:space:]]*//' | sort -u)

    for i in "${!SIMS[@]}"; do
      printf "  %2d) %s\n" "$((i+1))" "${SIMS[$i]}"
    done
    echo ""
    read -rp "Pick a simulator (number), or press Enter for iPhone 17 Pro: " CHOICE

    if [[ -z "$CHOICE" ]]; then
      DEVICE="iPhone 17 Pro"
    elif [[ "$CHOICE" =~ ^[0-9]+$ ]] && (( CHOICE >= 1 && CHOICE <= ${#SIMS[@]} )); then
      DEVICE="${SIMS[$((CHOICE-1))]}"
    else
      echo "🚨 Invalid choice: $CHOICE"
      exit 1
    fi
    ;;
  *)
    echo "Usage: $0 [iphone|ipad|ipad-11|ipad-mini|ipad-air]"
    echo "       $0            (interactive picker)"
    exit 1
    ;;
esac

echo ""
echo "🚀 Launching on: $DEVICE"
echo "   Metro bundler will start automatically for instant hot-reload."
echo ""

npx expo run:ios --device "$DEVICE"
