/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        rasvia: {
          black: "#0f0f0f",
          dark: "#1a1a1a",
          card: "#222222",
          muted: "#2a2a2a",
          border: "#333333",
          text: "#f5f5f5",
          subtle: "#999999",
          saffron: "#FF9933",
          "saffron-dark": "#CC7A29",
          green: "#22C55E",
          amber: "#F59E0B",
          red: "#EF4444",
        },
      },
      fontFamily: {
        "bricolage": ["BricolageGrotesque_800ExtraBold"],
        "bricolage-bold": ["BricolageGrotesque_700Bold"],
        "bricolage-semibold": ["BricolageGrotesque_600SemiBold"],
        "manrope": ["Manrope_500Medium"],
        "manrope-bold": ["Manrope_700Bold"],
        "manrope-semibold": ["Manrope_600SemiBold"],
        "jetbrains": ["JetBrainsMono_600SemiBold"],
      },
    },
  },
  plugins: [],
};
