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
  # Clear stale logs only on the dispatcher pass. The --foreground worker must not
  # unlink the log path: the parent shell already opened it for >> redirect.
  rm -f "$REPO_ROOT/build_ios_background.log" "$REPO_ROOT/build_ios.log"
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

# ── iPad sanity check ──────────────────────────────────────────────────────
# A single universal IPA covers both iPhone and iPad when:
#   • ios.supportsTablet = true          (shows in iPad App Store search)
#   • ios.requireFullScreen = false      (enables Split View / Stage Manager)
#   • UISupportedInterfaceOrientations~ipad lists all four orientations
# We verify these now so the build doesn't get silently submitted with the
# wrong config.

echo "Verifying iPad config in app.json..."

SUPPORTS_TABLET=$(node -e "const c=require('./app.json'); process.stdout.write(String(c.expo.ios.supportsTablet))")
REQUIRE_FULL=$(node -e "const c=require('./app.json'); process.stdout.write(String(c.expo.ios.requireFullScreen))")
IPAD_ORIENT=$(node -e "const c=require('./app.json'); const o=c.expo.ios.infoPlist['UISupportedInterfaceOrientations~ipad']; process.stdout.write(o ? o.join(',') : 'MISSING')")

if [[ "$SUPPORTS_TABLET" != "true" ]]; then
  echo "🚨 Error: ios.supportsTablet must be true for iPad App Store availability."
  exit 1
fi

if [[ "$REQUIRE_FULL" != "false" ]]; then
  echo "🚨 Error: ios.requireFullScreen must be false to enable Split View / Stage Manager."
  exit 1
fi

if [[ "$IPAD_ORIENT" == "MISSING" ]]; then
  echo "🚨 Error: UISupportedInterfaceOrientations~ipad is missing from infoPlist."
  exit 1
fi

echo "✅ iPad config OK"
echo "   supportsTablet  : $SUPPORTS_TABLET"
echo "   requireFullScreen: $REQUIRE_FULL"
echo "   iPad orientations: $IPAD_ORIENT"

# ── Build ──────────────────────────────────────────────────────────────────

# Clear old IPA files to ensure we don't accidentally submit an old build
echo "Cleaning up old IPA artifacts..."
rm -f build-*.ipa

echo "Compiling the iOS build locally (universal iPhone + iPad IPA)..."
# --non-interactive is required to prevent EAS from hanging on Apple ID prompts
EAS_SKIP_AUTO_FINGERPRINT=1 eas build --platform ios --profile production --local --non-interactive

# Automatically find the newly generated .ipa file
IPA_FILE=$(find . -maxdepth 1 -name "build-*.ipa" -type f | head -n 1)

if [ -z "$IPA_FILE" ]; then
    echo "🚨 Error: No IPA file found! The build process may have failed."
    exit 1
fi

echo "✅ Successfully built: $IPA_FILE"

echo "Submitting universal IPA to App Store Connect / TestFlight..."
eas submit --platform ios --path "$IPA_FILE" --non-interactive

echo "✅ App submitted successfully!"
echo "   Both iPhone and iPad builds are covered by this single universal IPA."