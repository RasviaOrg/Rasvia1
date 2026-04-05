#!/bin/bash
set -e

# Clear old IPA files to ensure we don't accidentally submit an old build
echo "Cleaning up old IPA artifacts..."
rm -f build-*.ipa

echo "Compiling the iOS build locally..."
# --non-interactive is required to prevent EAS from hanging on Apple ID prompts
eas build --platform ios --profile production --local --non-interactive

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
