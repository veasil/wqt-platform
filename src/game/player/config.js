import { domainError } from "../activities/link.js";
export const defaultQuestions = {
  version: "1",
  questions: [
    {
      id: "participation",
      label: "本场参与投入程度",
      type: "select",
      options: ["很投入", "一般", "需要更多支持"],
    },
    { id: "learning", label: "本场最重要的发现或收获", type: "text" },
    { id: "improvement", label: "下一场希望如何调整", type: "text" },
  ],
};
export function validatePlayerSetting(key, raw) {
  if (!["PLAYER_QUESTIONNAIRE", "PLAYER_BRAND_RESOURCE"].includes(key)) return;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw domainError(400, "玩家配置需要有效JSON");
  }
  if (key === "PLAYER_QUESTIONNAIRE") {
    if (
      typeof value.version !== "string" ||
      !value.version ||
      !Array.isArray(value.questions) ||
      value.questions.length < 1 ||
      value.questions.length > 20 ||
      !value.questions.every(
        (q) =>
          /^[a-zA-Z0-9_-]{1,50}$/.test(q.id) &&
          typeof q.label === "string" &&
          q.label.length > 0 &&
          q.label.length <= 200 &&
          ["text", "select"].includes(q.type) &&
          (q.type !== "select" ||
            (Array.isArray(q.options) &&
              q.options.length > 0 &&
              q.options.every(
                (o) => typeof o === "string" && o.length <= 100,
              ))),
      ) ||
      new Set(value.questions.map((q) => q.id)).size !== value.questions.length
    )
      throw domainError(400, "问卷版本或问题格式无效");
  } else if (
    typeof value.revision !== "string" ||
    !value.revision ||
    typeof value.image !== "string" ||
    !value.image.startsWith("/") ||
    value.image.startsWith("//") ||
    /[\\<>\r\n]/.test(value.image) ||
    typeof value.title !== "string" ||
    value.title.length > 200 ||
    typeof value.alt !== "string" ||
    value.alt.length > 200
  )
    throw domainError(400, "品牌资源需要版本、同源图片路径、标题及替代文字");
  return value;
}
