import { getAllSettings } from "../../db.js";

export function registerSettingsRoutes(app) {
  // ======== API: 数据库测试 ========
  app.get("/api/db/test", async (req, res) => {
    // ... (omitted for brevity)
  });

  // ======== API: System Settings ========
  app.get("/api/settings", async (req, res) => {
    try {
      const publicKeys = new Set([
        "DEFAULT_GAME_TIME",
        "GAME_MODES",
        "REVIEW_MIN_CARDS",
        "BRANDING_INFO",
        "ATTRIBUTES_CONFIG",
      ]);
      const settings = (await getAllSettings()).filter((setting) =>
        publicKeys.has(setting.key),
      );
      res.json({ ok: true, settings });
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });
}
