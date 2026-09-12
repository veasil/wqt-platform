export default [{
  files: ["src/app.js", "src/runtime.js", "src/platform/**/*.js", "src/game/**/*.js", "src/integrations/**/*.js"],
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    globals: Object.fromEntries([
      "process", "console", "Buffer", "setInterval", "clearInterval", "setTimeout",
      "clearTimeout", "URL", "fetch", "AbortController",
    ].map(name => [name, "readonly"])),
  },
  rules: { "no-undef": "error" },
}];
