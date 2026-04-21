#!/bin/bash
set -e

# Always operate from the repo root, regardless of where the user invoked us
# from. expo-updates / eas resolve the project root from process.cwd(), and
# if that's `scripts/` they end up looking for `scripts/package.json` and
# crashing with "The expected package.json path: .../scripts/package.json
# does not exist".
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Default: detach so the terminal returns immediately (long EAS local builds).
# Pass --foreground to stay attached (CI, debugging). Override log path with BUILD_IOS_LOG.
if [[ "${1:-}" != "--foreground" ]]; then
  LOG_FILE="${BUILD_IOS_LOG:-$REPO_ROOT/build_ios_background.log}"
  nohup bash "$SCRIPT_DIR/build_and_submit_ios.sh" --foreground >>"$LOG_FILE" 2>&1 &
  echo "iOS build and submit running in background (PID $!)."
  echo "Log: $LOG_FILE"
  echo "Tail: tail -f \"$LOG_FILE\""
  echo "Run with --foreground to attach in this terminal instead."
  exit 0
fi
shift

cd "$REPO_ROOT"

# Clear old IPA files to ensure we don't accidentally submit an old build
echo "Cleaning up old IPA artifacts..."
rm -f build-*.ipa

echo "Compiling the iOS build locally..."
# --non-interactive is required to prevent EAS from hanging on Apple ID prompts
EAS_SKIP_AUTO_FINGERPRINT=1 eas build --platform ios --profile production --local --non-interactive

# Automatically find the newly generated .ipa file
IPA_FILE=$(find . -maxdepth 1 -name "build-*.ipa" -type f | head -n 1)

if [ -z "$IPA_FILE" ]; then
    echo "🚨 Error: No IPA file found! The build process may have failed."
    exit 1
fi

echo "✅ Successfully built: $IPA_FILE"
echo "Submitting to App Store / TestFlight..."

eas submit --platform ios --path "$IPA_FILE" --non-interactive

echo "✅ App submitted successfully!"
