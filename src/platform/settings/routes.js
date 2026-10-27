import { getAllSettings } from "../../db.js";
import {accountModelEnabled} from '../accounts/model.js';
import {CAPTCHA_ENABLED} from '../../services/captcha.js';
import {publicCaptchaOptions} from '../../services/captcha-config.js';
import {smsMode} from '../../services/sms.js';

export function registerSettingsRoutes(app) {
  app.get('/api/auth/verification-options',(_req,res)=>res.set('Cache-Control','no-store').json({password:true,sms:smsMode()!=='unavailable' && (CAPTCHA_ENABLED || !accountModelEnabled() || ['test','development'].includes(process.env.NODE_ENV)),smsMode:smsMode(),wechat:false,...publicCaptchaOptions()}));
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
      res.json({ ok: true, settings,accountModel:accountModelEnabled() ? 'accounts':'legacy' });
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });
}
