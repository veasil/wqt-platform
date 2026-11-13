// Browser contract tests mock all API calls. This imports the app without initializing any database.
import { createApp } from "../../src/app.js";
import express from 'express';
import path from 'node:path';
const app=express();
if(process.env.WQT_BROWSER_ADMIN_DIST) {
  const dist=path.resolve(process.env.WQT_BROWSER_ADMIN_DIST);
  app.use('/admin',express.static(dist));
  app.get('/admin/*',(_req,res)=>res.sendFile(path.join(dist,'index.html')));
}
app.use(createApp());
const server = app.listen(0, "127.0.0.1", () => {
  console.log(JSON.stringify({ port: server.address().port }));
});
process.once("SIGTERM", () => server.close());
