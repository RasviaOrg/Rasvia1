module.exports = function (api) {
  api.cache(true);

  const plugins = [];

  if (process.env.NODE_ENV === "production") {
    plugins.push(["transform-remove-console", { exclude: ["error"] }]);
  }

  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    plugins,
  };
};
