#!/bin/bash
set -e

echo "🚀 Compiling and launching the iOS app locally..."
echo "If no simulator is currently running, Expo will automatically start one."
echo "If you have a physical device connected, Expo may prompt you to select it."

# This command compiles the native iOS code and installs it on the simulator/device
# It will also start the Metro bundler so you can test your changes instantly
npx expo run:ios
