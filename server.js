import dotenv from "dotenv";

dotenv.config();
const { startRuntime } = await import("./src/runtime.js");
await startRuntime();
