import { dbGet } from "../../db.js";
import { authMiddleware } from "../../middleware/auth.js";
import fetch from "node-fetch";
import { decryptVal } from "../../config.js";
import {
  generateWithDashScope,
  generateWithToApis,
} from "../../services/image-generation.js";

export function registerMediaRoutes(app, { config, ossClient, upload } = {}) {
  // ======== API: LLM proxy（可选） ========
  // 你原 index.html 里把 Key 写死在前端了（非常危险），这里提供一个安全的后端代理。
  app.post("/api/llm/story", authMiddleware, async (req, res) => {
    const prompt = req.body?.prompt;
    if (!prompt) return res.status(400).json({ error: "缺少 prompt" });

    const rawMaxTokens = Number(req.body?.max_tokens);
    const maxTokens = Number.isFinite(rawMaxTokens)
      ? Math.min(Math.max(rawMaxTokens, 200), 8000)
      : 1200;
    const rawTemperature = Number(req.body?.temperature);
    const temperature = Number.isFinite(rawTemperature)
      ? Math.min(Math.max(rawTemperature, 0), 1.2)
      : 0.7;

    // 获取模型配置
    let provider = req.body?.provider || "";
    let model = req.body?.model || "";

    try {
      // 默认从数据库中读取全局使用的生产环境配置为主
      if (!provider || !model) {
        const pRow = await dbGet(
          "SELECT value FROM system_settings WHERE key = 'DEFAULT_LLM_PROVIDER'",
        );
        const mRow = await dbGet(
          "SELECT value FROM system_settings WHERE key = 'DEFAULT_LLM_MODEL'",
        );
        if (pRow && pRow.value) provider = provider || pRow.value;
        if (mRow && mRow.value) model = model || mRow.value;
      }

      // 后备方案机制
      provider = provider || "OpenAI";
      model = model || "gpt-4o-mini";

      let apiKey = "";
      let baseUrl = "";

      // 从数据库 system_settings 拿当前 provider 的配置（注意解密）
      if (provider === "OpenAI") {
        let kRow = await dbGet(
          "SELECT value FROM system_settings WHERE key = 'OPENAI_API_KEY'",
        );
        let uRow = await dbGet(
          "SELECT value FROM system_settings WHERE key = 'OPENAI_BASE_URL'",
        );
        apiKey =
          kRow && kRow.value
            ? decryptVal(kRow.value)
            : process.env.OPENAI_API_KEY;
        baseUrl =
          uRow && uRow.value
            ? decryptVal(uRow.value)
            : process.env.OPENAI_BASE_URL ||
              "https://api.openai.com/v1/chat/completions";
      } else if (provider === "Google Gemini") {
        let kRow = await dbGet(
          "SELECT value FROM system_settings WHERE key = 'GEMINI_API_KEY'",
        );
        let uRow = await dbGet(
          "SELECT value FROM system_settings WHERE key = 'GEMINI_BASE_URL'",
        );
        apiKey =
          kRow && kRow.value
            ? decryptVal(kRow.value)
            : process.env.GEMINI_API_KEY;
        baseUrl =
          uRow && uRow.value
            ? decryptVal(uRow.value)
            : process.env.GEMINI_BASE_URL ||
              "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
      } else if (provider === "阿里云 DashScope") {
        let kRow = await dbGet(
          "SELECT value FROM system_settings WHERE key = 'DASHSCOPE_API_KEY'",
        );
        let uRow = await dbGet(
          "SELECT value FROM system_settings WHERE key = 'DASHSCOPE_BASE_URL'",
        );
        apiKey =
          kRow && kRow.value
            ? decryptVal(kRow.value)
            : process.env.DASHSCOPE_API_KEY;
        baseUrl =
          uRow && uRow.value
            ? decryptVal(uRow.value)
            : process.env.DASHSCOPE_BASE_URL ||
              "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
      } else {
        // DeepSeek 或 其他兼容
        let kRow = await dbGet(
          "SELECT value FROM system_settings WHERE key = 'DEEPSEEK_API_KEY'",
        );
        let uRow = await dbGet(
          "SELECT value FROM system_settings WHERE key = 'DEEPSEEK_BASE_URL'",
        );
        apiKey =
          kRow && kRow.value
            ? decryptVal(kRow.value)
            : process.env.DEEPSEEK_API_KEY;
        baseUrl =
          uRow && uRow.value
            ? decryptVal(uRow.value)
            : process.env.DEEPSEEK_BASE_URL ||
              "https://api.deepseek.com/chat/completions";
        model = model || process.env.DEEPSEEK_MODEL || "deepseek-chat";
      }

      if (!apiKey) {
        return res
          .status(400)
          .json({ error: `后端未配置 ${provider} 的 API_KEY` });
      }

      const start_time = Date.now();
      const isCodex = baseUrl.includes("/v1/responses");

      let reqBody;
      if (isCodex) {
        reqBody = {
          model,
          input: [
            {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: prompt }],
            },
          ],
        };
      } else {
        reqBody = {
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxTokens,
          temperature,
        };
      }

      // 调用 API
      const r = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(reqBody),
      });

      if (!r.ok) {
        const t = await r.text().catch(() => "");
        console.error(`LLM Call Failed [${provider}]: ${r.status} - ${t}`);
        return res
          .status(502)
          .json({ error: `LLM 调用失败(${r.status}) ${t?.slice(0, 200)}` });
      }

      const data = await r.json();
      let story = "";
      if (isCodex) {
        story = data?.output?.[0]?.content?.[0]?.text || "";
      } else {
        story = data?.choices?.[0]?.message?.content || "";
      }

      const elapsedMs = Date.now() - start_time;
      // 返回带上耗时统计
      res.json({
        story,
        performance: { elapsed_ms: elapsedMs, provider, model },
      });
    } catch (e) {
      console.error(`LLM Network Error:`, e);
      res.status(502).json({ error: "LLM 网络请求失败" });
    }
  });

  // ======== API: 文生图 / 参考图生图（复盘报告插画 / banner）========
  // 返回 base64 data URI，便于前端 html2canvas 导出海报时无跨域问题。
  // provider=toapis 时支持 multipart image、imageUrl、image_urls、imageDataUri 作为参考图。
  app.post(
    "/api/llm/image",
    authMiddleware,
    upload.single("image"),
    async (req, res) => {
      const prompt = (req.body?.prompt || "").toString().trim();
      if (!prompt) return res.status(400).json({ error: "缺少 prompt" });

      const size = (req.body?.size || "1024*1024").toString();

      try {
        const getSetting = async (key, fallback = "") => {
          const row = await dbGet(
            "SELECT value FROM system_settings WHERE key = ?",
            [key],
          );
          return row && row.value ? decryptVal(row.value) : fallback;
        };

        const provider = String(
          req.body?.provider ||
            (await getSetting(
              "IMAGE_PROVIDER",
              process.env.IMAGE_PROVIDER ||
                (process.env.TOAPIS_API_KEY ? "toapis" : "dashscope"),
            )),
        ).toLowerCase();

        if (provider === "toapis") {
          const apiKey = await getSetting(
            "TOAPIS_API_KEY",
            process.env.TOAPIS_API_KEY,
          );
          if (!apiKey) {
            return res
              .status(501)
              .json({ error: "后端未配置 TOAPIS_API_KEY（生图功能不可用）" });
          }

          const result = await generateWithToApis({
            apiKey,
            baseUrl: await getSetting(
              "TOAPIS_BASE_URL",
              process.env.TOAPIS_BASE_URL || "https://toapis.com",
            ),
            model:
              req.body?.model ||
              (await getSetting(
                "TOAPIS_IMAGE_MODEL",
                process.env.TOAPIS_IMAGE_MODEL || "gpt-image-2",
              )),
            prompt,
            size,
            resolution:
              req.body?.resolution ||
              (await getSetting(
                "TOAPIS_IMAGE_RESOLUTION",
                process.env.TOAPIS_IMAGE_RESOLUTION || "1k",
              )),
            quality:
              req.body?.quality ||
              (await getSetting(
                "TOAPIS_IMAGE_QUALITY",
                process.env.TOAPIS_IMAGE_QUALITY || "medium",
              )),
            file: req.file,
            body: req.body,
            timeoutMs: Number(req.body?.timeoutMs) || 120000,
          });
          return res.json(result);
        }

        const apiKey = await getSetting(
          "DASHSCOPE_API_KEY",
          process.env.DASHSCOPE_API_KEY,
        );
        if (!apiKey) {
          return res
            .status(501)
            .json({ error: "后端未配置 DASHSCOPE_API_KEY（生图功能不可用）" });
        }
        const model = await getSetting(
          "DASHSCOPE_IMAGE_MODEL",
          process.env.DASHSCOPE_IMAGE_MODEL || "wanx2.1-t2i-turbo",
        );
        const result = await generateWithDashScope({
          apiKey,
          model,
          prompt,
          size,
        });
        res.json(result);
      } catch (e) {
        console.error("生图接口异常:", e);
        const status = String(e.message || "").includes("超时") ? 504 : 502;
        res.status(status).json({ error: e.message || "生图网络请求失败" });
      }
    },
  );

  // ======== API: Upload to OSS ========
  app.post(
    "/api/upload/audio",
    authMiddleware,
    upload.single("file"),
    async (req, res) => {
      if (!ossClient)
        return res.status(500).json({ error: "服务器未配置 OSS" });
      if (!req.file) return res.status(400).json({ error: "未上传文件" });

      try {
        const filename = `game-audio/user_${req.user.uid}_${Date.now()}.webm`;
        const result = await ossClient.put(filename, req.file.buffer);

        // 生成访问链接
        let url = result.url;
        if (process.env.ALIYUN_OSS_CUSTOM_DOMAIN) {
          const domain = process.env.ALIYUN_OSS_CUSTOM_DOMAIN.replace(
            /\/$/,
            "",
          );
          url = `${domain}/${result.name}`;
        }

        res.json({ ok: true, url });
      } catch (e) {
        console.error("OSS Upload Error:", e);
        res.status(500).json({ error: "上传失败: " + e.message });
      }
    },
  );

  app.post("/api/upload/report", authMiddleware, async (req, res) => {
    if (!ossClient) return res.status(500).json({ error: "服务器未配置 OSS" });

    const { html, markdown } = req.body || {};
    if (!html && !markdown)
      return res.status(400).json({ error: "缺少报告内容" });

    try {
      const timestamp = Date.now();
      const resultUrls = {};
      const customDomain = process.env.ALIYUN_OSS_CUSTOM_DOMAIN
        ? process.env.ALIYUN_OSS_CUSTOM_DOMAIN.replace(/\/$/, "")
        : null;

      if (html) {
        const filename = `game-review/report_${req.user.uid}_${timestamp}.html`;
        const r = await ossClient.put(filename, Buffer.from(html));
        resultUrls.htmlUrl = customDomain ? `${customDomain}/${r.name}` : r.url;
      }

      if (markdown) {
        const filename = `game-review/report_${req.user.uid}_${timestamp}.md`;
        const r = await ossClient.put(filename, Buffer.from(markdown));
        resultUrls.markdownUrl = customDomain
          ? `${customDomain}/${r.name}`
          : r.url;
      }

      res.json({ ok: true, ...resultUrls });
    } catch (e) {
      console.error("OSS Upload Error:", e);
      res.status(500).json({ error: "上传失败: " + e.message });
    }
  });

  // ======== API: OSS Management (Admin) ========
  app.get("/api/admin/oss/files", authMiddleware, async (req, res) => {
    if (!ossClient) return res.status(500).json({ error: "服务器未配置 OSS" });

    try {
      const { prefix, marker, maxKeys, delimiter } = req.query;
      const query = {
        prefix: prefix || null,
        marker: marker || null,
        "max-keys": maxKeys ? Number(maxKeys) : 20,
        delimiter: delimiter || "/", // Default to directory mode
      };

      // ossClient.list returns { objects: [], prefixes: [], nextMarker: string, res: ... }
      const result = await ossClient.list(query);

      const customDomain = process.env.ALIYUN_OSS_CUSTOM_DOMAIN
        ? process.env.ALIYUN_OSS_CUSTOM_DOMAIN.replace(/\/$/, "")
        : null;

      const files = (result.objects || []).map((obj) => ({
        name: obj.name,
        url: customDomain ? `${customDomain}/${obj.name}` : obj.url,
        size: obj.size,
        lastModified: obj.lastModified,
      }));

      // Prefixes are subdirectories
      const folders = result.prefixes || [];

      res.json({
        ok: true,
        files,
        folders,
        nextMarker: result.nextMarker,
        isTruncated: result.isTruncated,
      });
    } catch (e) {
      console.error("OSS List Error:", e);
      res.status(500).json({ error: "获取文件列表失败: " + e.message });
    }
  });

  app.delete("/api/admin/oss/files", authMiddleware, async (req, res) => {
    if (!ossClient) return res.status(500).json({ error: "服务器未配置 OSS" });

    const { filename } = req.body; // Expect JSON body: { "filename": "path/to/file" }
    if (!filename) return res.status(400).json({ error: "未指定文件名" });

    try {
      // ossClient.delete returns result object
      const result = await ossClient.delete(filename);
      console.log(`🗑️ Deleted OSS file: ${filename}`, result.res.status);

      res.json({ ok: true, filename });
    } catch (e) {
      console.error("OSS Delete Error:", e);
      res.status(500).json({ error: "删除文件失败: " + e.message });
    }
  });
}
