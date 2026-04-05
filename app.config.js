const appJson = require("./app.json");

const config = appJson.expo;
const googleMapsApiKey =
  process.env.GOOGLE_MAPS_API_KEY || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

if (!googleMapsApiKey) {
  // Keep startup explicit so missing build env is visible immediately.
  console.warn(
    "GOOGLE_MAPS_API_KEY (or EXPO_PUBLIC_GOOGLE_MAPS_API_KEY) is not set; Android Maps may fail in native builds."
  );
}

module.exports = {
  ...config,
  android: {
    ...config.android,
    config: {
      ...(config.android?.config ?? {}),
      ...(googleMapsApiKey
        ? {
            googleMaps: {
              apiKey: googleMapsApiKey,
            },
          }
        : {}),
    },
  },
};
