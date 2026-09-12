import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "node:path";
import multer from "multer";
import { config as defaultConfig } from "./config.js";
import { ROOT_DIR } from "./paths.js";
import authRouter from "./routes/auth.routes.js";
import accountAdminRouter from "./routes/account-admin.routes.js";
import adminDataRouter from "./routes/admin-data.routes.js";
import { registerSettingsRoutes } from "./platform/settings/routes.js";
import { registerProfileRoutes } from "./platform/identity/profile.routes.js";
import { registerOrganizationRoutes } from "./platform/organizations/routes.js";
import { registerSessionRoutes } from "./game/sessions/routes.js";
import {
  registerCardRoutes,
  registerCardVersionRoutes,
} from "./game/cards/routes.js";
import { registerMediaRoutes } from "./integrations/media/routes.js";
import { registerActivityRoutes } from "./game/activities/routes.js";

export function createApp({
  runtimeConfig = defaultConfig,
  ossClient = null,
} = {}) {
  const config = runtimeConfig;
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  // 信任反向代理（Zeabur/nginx），让 req.ip 取到真实客户端 IP——短信接口 IP 限流依赖它
  app.set("trust proxy", 1);

  // ======== 安全响应头 (HSTS / CSP / X-Frame-Options 等) ========
  // CSP 白名单按前端实际加载的外部资源收敛：
  //   - script: cdn.jsdelivr.net (html2canvas)；内联脚本/事件处理器较多，暂放 'unsafe-inline'，后续可改 nonce
  //   - style:   fonts.googleapis.com；内联 <style> 普遍，放 'unsafe-inline'
  //   - font:    fonts.gstatic.com (Google Fonts 实际字体文件)
  //   - img/media: 阿里云 OSS 香港桶（卡面/音频）；img 另含 data: (LLM 文生图返回 base64)
  //   - connect: 仅同源（前端不直连外部 API，LLM/OSS 都走后端代理）
  app.use(
    helmet({
      // 关闭 COEP：OSS/jsdelivr/gstatic 不发 CORP 头，require-corp 会把这些图片/脚本/字体全部拦掉
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": [
            "'self'",
            "'unsafe-inline'",
            "https://cdn.jsdelivr.net",
          ],
          // helmet 默认带 script-src-attr 'none' 会屏蔽所有 onclick=/onsubmit= 等内联事件处理器
          // (index.html/my.html 等大量用到)，显式放开与 script-src 同等放宽，保持现状不破
          "script-src-attr": ["'unsafe-inline'"],
          "style-src": [
            "'self'",
            "'unsafe-inline'",
            "https://fonts.googleapis.com",
          ],
          "font-src": ["'self'", "https://fonts.gstatic.com"],
          "img-src": [
            "'self'",
            "data:",
            "https://ai5000days-scoring-system-hk.oss-cn-hongkong.aliyuncs.com",
          ],
          "media-src": [
            "'self'",
            "https://ai5000days-scoring-system-hk.oss-cn-hongkong.aliyuncs.com",
          ],
          "connect-src": ["'self'"],
          "frame-ancestors": ["'none'"],
          "object-src": ["'none'"],
          "base-uri": ["'self'"],
          "form-action": ["'self'"],
        },
      },
      // frame-ancestors 'none' 已覆盖；X-Frame-Options 留 DENY 作为旧浏览器回退
      xFrameOptions: { action: "deny" },
      // HSTS：max-age 1 年，含子域
      strictTransportSecurity: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    }),
  );

  app.use(morgan("dev"));
  // 复盘报告内嵌大量 base64 图片（卡面/插画/品牌 banner），单独放宽该路由的 body 上限；
  // 其余接口仍走 2mb 全局限制（此中间件先于全局解析，express.json 解析后会 skip 重复解析）。
  app.use("/api/upload/report", express.json({ limit: "16mb" }));
  app.use(express.json({ limit: "2mb" }));

  // 本地开发：同域访问最省事；如果你前后端分离，这里把 origin 改成你的前端地址
  app.use(
    cors({
      origin: true,
      credentials: false,
    }),
  );

  // 静态资源
  app.use(express.static(path.join(ROOT_DIR, "public")));

  // 组织管理前端 SPA
  const enterpriseDist = path.join(ROOT_DIR, "enterprise-panel", "dist");
  app.use("/enterprise", express.static(enterpriseDist));
  app.get("/enterprise/*", (req, res, next) => {
    if (req.path.startsWith("/enterprise/api")) return next();
    res.sendFile(path.join(enterpriseDist, "index.html"), (err) => {
      if (err) next();
    });
  });

  // 中台管理前端 SPA（admin-web，替代 Streamlit）
  const adminWebDist = path.join(ROOT_DIR, "admin-web", "dist");
  app.use("/admin", express.static(adminWebDist));
  app.get("/admin/*", (req, res, next) => {
    if (req.path.startsWith("/admin/api")) return next();
    res.sendFile(path.join(adminWebDist, "index.html"), (err) => {
      if (err) next();
    });
  });

  registerSettingsRoutes(app);
  registerProfileRoutes(app, { ossClient });
  registerOrganizationRoutes(app);
  registerSessionRoutes(app);
  registerCardRoutes(app);
  registerMediaRoutes(app, { config, ossClient, upload });
  registerActivityRoutes(app);
  registerCardVersionRoutes(app);

  app.use(authRouter);
  app.use(accountAdminRouter);
  app.use(adminDataRouter);

  app.use((req, res) => {
    if (
      req.path.startsWith("/api/") ||
      req.path.startsWith("/enterprise/api") ||
      req.path.startsWith("/admin/api")
    ) {
      return res.status(404).json({ error: "接口不存在", path: req.path });
    }
    if (req.accepts("json") && !req.accepts("html")) {
      return res.status(404).json({ error: "资源不存在", path: req.path });
    }
    res.status(404).sendFile(path.join(ROOT_DIR, "public", "404.html"));
  });

  return app;
}
