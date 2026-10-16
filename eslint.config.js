export default [{
  files: ["src/app.js", "src/runtime.js", "src/startup-guards.js", "src/db.js", "src/db/migrations/**/*.js", "src/development/**/*.js", "src/middleware/**/*.js", "src/services/**/*.js", "src/platform/**/*.js", "src/game/**/*.js", "src/integrations/**/*.js"],
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    globals: Object.fromEntries([
      "process", "console", "Buffer", "setInterval", "clearInterval", "setTimeout",
      "clearTimeout", "URL", "fetch", "AbortController", "FormData", "Blob",
    ].map(name => [name, "readonly"])),
  },
  rules: { "no-undef": "error" },
}];
