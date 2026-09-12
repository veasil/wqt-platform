// Browser contract tests mock all API calls. This imports the app without initializing any database.
import { createApp } from "../../src/app.js";
const server = createApp().listen(0, "127.0.0.1", () => {
  console.log(JSON.stringify({ port: server.address().port }));
});
process.once("SIGTERM", () => server.close());
