import crypto from "crypto";
import { dbGet } from "../../db.js";
// 活动码品类前缀（1 位）。新增品类时在此登记即可。
const ACTIVITY_CATEGORY_PREFIX = {
  test: "T", // 测试活动
  series: "S", // 系列活动
  enterprise: "E", // 企业级活动
  apply: "A", // 组织申请活动（pending_approval）
  general: "G", // 普通/官方活动（默认）
};

// 生成活动码：<品类前缀1位><4位随机>，共 5 位（如 T7K9Q / E3M8X）。
//   - 随机字符集去掉易混淆的 0/O/1/I；查询侧大小写不敏感（lookup 时 toUpperCase）。
//   - 不再用顺序自增：避免可枚举猜测、不暴露活动总数，也绕开 id 序列脱节的唯一约束坑。
//   - 历史 ACT-xxx 旧码不受影响（仍可按原值查询）。
export async function generateActivityCode(category = "general") {
  const prefix =
    ACTIVITY_CATEGORY_PREFIX[category] || ACTIVITY_CATEGORY_PREFIX.general;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 12; attempt++) {
    const bytes = crypto.randomBytes(4);
    let rand = "";
    for (let i = 0; i < 4; i++) rand += alphabet[bytes[i] % alphabet.length];
    const code = prefix + rand;
    const exists = await dbGet(
      "SELECT id FROM activities WHERE activity_code = ?",
      [code],
    );
    if (!exists) return code;
  }
  // 极小概率连续碰撞，回退加时间戳后缀保证唯一
  return `${prefix}${Date.now().toString(36).toUpperCase()}`;
}

// 生成唯一邀请码：8 位大写字母+数字（去掉易混淆的 0/O/1/I），与 invite_codes.code 去重
export async function generateInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 10; attempt++) {
    const bytes = crypto.randomBytes(8);
    let code = "";
    for (let i = 0; i < 8; i++) code += alphabet[bytes[i] % alphabet.length];
    const exists = await dbGet("SELECT id FROM invite_codes WHERE code = ?", [
      code,
    ]);
    if (!exists) return code;
  }
  // 极小概率连续碰撞，回退加时间戳后缀保证唯一
  return `INV${Date.now().toString(36).toUpperCase()}`;
}
