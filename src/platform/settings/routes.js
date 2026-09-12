import { getAllSettings } from "../../db.js";

export function registerSettingsRoutes(app) {
  // ======== API: 数据库测试 ========
  app.get("/api/db/test", async (req, res) => {
    // ... (omitted for brevity)
  });

  // ======== API: System Settings ========
  app.get("/api/settings", async (req, res) => {
    try {
      const settings = await getAllSettings();
      // 过滤掉敏感或不适合前端直接看到的配置（如果有的话）
      // 目前全部返回
      res.json({ ok: true, settings });
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });
}
