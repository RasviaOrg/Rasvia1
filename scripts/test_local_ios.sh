#!/bin/bash
set -e

# Always operate from the repo root — see build_and_submit_ios.sh for why.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "🚀 Compiling and launching the iOS app locally..."
echo "If no simulator is currently running, Expo will automatically start one."
echo "If you have a physical device connected, Expo may prompt you to select it."

# This command compiles the native iOS code and installs it on the simulator/device
# It will also start the Metro bundler so you can test your changes instantly
npx expo run:ios
