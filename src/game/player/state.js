import { domainError } from "../activities/link.js";
export const abilities = ["安全力", "脑波力", "实感力", "创心力", "沟通力"];
export const phases = ["启蒙期", "成长期", "青春期"];
export function initialState(settings, now = Date.now()) {
  const duration = Number(settings?.duration),
    counts = settings?.counts;
  if (
    !Number.isInteger(duration) ||
    duration < 1 ||
    duration > 10800 ||
    !Array.isArray(counts) ||
    counts.length !== 3 ||
    !counts.every((n) => Number.isInteger(n) && n >= 0 && n <= 15) ||
    !counts.some((n) => n > 0)
  )
    throw domainError(400, "游戏配置无效");
  return {
    version: 1,
    revision: 0,
    duration,
    counts,
    phase: counts.findIndex((n) => n > 0),
    done: [0, 0, 0],
    values: [3, 3, 3, 3, 3],
    used: [],
    skillCards: {},
    choices: [],
    d: {},
    startedAt: now,
    paused: false,
    pauseAt: null,
    pausedMs: 0,
    failures: 0,
    pending: null,
    ended: false,
  };
}
export function remaining(state, now = Date.now()) {
  return Math.max(
    0,
    state.duration -
      Math.floor(
        ((state.paused ? state.pauseAt : now) -
          state.startedAt -
          state.pausedMs) /
          1000,
      ),
  );
}
export function applyAction(state, input, card, now = Date.now()) {
  const next = globalThis.structuredClone(state),
    payload = {};
  let type = input.action;
  if (next.ended) throw domainError(409, "本局已结算");
  if (Number(input.revision) !== next.revision)
    throw domainError(409, "场次已变化，请刷新后重试");
  if (next.paused && !["pause", "finish"].includes(type))
    throw domainError(409, "本局暂停中");
  if (remaining(next, now) === 0 && type !== "finish")
    throw domainError(409, "时间已到，请结算本局");
  if (type === "pause") {
    if (next.paused) {
      next.pausedMs += now - next.pauseAt;
      next.pauseAt = null;
    } else next.pauseAt = now;
    next.paused = !next.paused;
  } else if (type === "adjust") {
    if (
      !Array.isArray(input.values) ||
      input.values.length !== 5 ||
      !input.values.every((v) => Number.isInteger(v) && v >= 0 && v <= 10) ||
      (input.reason != null && typeof input.reason !== 'string') ||
      String(input.reason ?? '').trim().length > 200
    )
      throw domainError(400, "请输入0至10的整数分数，调整理由最多200字");
    payload.before = next.values;
    next.values = [...input.values];
    payload.text = String(input.reason ?? '').trim();
  } else if (type === "skill") {
    const name = input.skill;
    if (!abilities.includes(name) || next.used.includes(name))
      throw domainError(409, "技能不可用或已使用");
    if (
      name === "创心力" &&
      (!card || next.choices.some((c) => c.cardId === card.id))
    )
      throw domainError(409, "请选择尚未确认的卡牌");
    if (name === "沟通力" && !card) throw domainError(400, "请选择当前卡牌");
    const before = [...next.values];
    if (name === "安全力")
      next.values = next.values.map((v) => (v === 1 ? 2 : v));
    else {
      const i = abilities.indexOf(name);
      next.values[i] = Math.min(10, next.values[i] + 1);
    }
    if (name === "创心力") {
      const text = String(input.text || "").trim();
      if (!text || text.length > 240)
        throw domainError(400, "方案需要1至240字");
      next.d[card.id] = text;
    }
    next.used.push(name);
    next.skillCards ||= {};
    if(card) next.skillCards[name]=card.id;
    type = "skill_use";
    Object.assign(payload, {
      skill: name,
      cardId: card?.id,
      optionD: input.text || "",
      attributesBefore: Object.fromEntries(
        abilities.map((n, i) => [n, before[i]]),
      ),
      attributesAfter: Object.fromEntries(
        abilities.map((n, i) => [n, next.values[i]]),
      ),
      attributeChange: Object.fromEntries(
        abilities.map((n, i) => [n, next.values[i] - before[i]]),
      ),
    });
  } else if (type === "choice") {
    if (next.pending) throw domainError(409, "请先处理阶段结果");
    if (
      !card ||
      !["A", "B", "C", "D"].includes(input.choice)
    )
      throw domainError(409, "卡牌不存在或已确认");
    // Card phase is a catalog filter; progress belongs to the current game phase.
    if (!phases.includes(card.phase))
      throw domainError(400, "卡牌阶段无效");
    const option = card.options[input.choice];
    if (input.choice === "D" && !next.d[card.id])
      throw domainError(400, "尚未创建选项D");
    if (input.choice !== "D" && !option) throw domainError(400, "选项不存在");
    const before = [...next.values],
      effects = input.choice === "D" ? {} : option.attributeEffects || {};
    if(Object.values(effects).some(v=>typeof v!=='number'||!Number.isFinite(v)||!Number.isInteger(v)||Math.abs(v)>10))throw domainError(503,'发布卡牌的计分配置无效，请联系管理员');
    next.values = abilities.map((n, i) =>
      Math.max(0, Math.min(10, before[i] + Number(effects[n] || 0))),
    );
    next.done[next.phase]++;
    Object.assign(payload, {
      cardId: card.id,
      cardCode: card.card_code,
      phase: card.phase,
      safetyType: card.safetyType,
      eventText: card.event,
      choice: input.choice,
      optionText: input.choice === "D" ? next.d[card.id] : option.text,
      consequence: input.choice === "D" ? "" : option.consequence,
      reason: input.choice === "D" ? "D选项不计分" : option.reason,
      allOptions: card.options,
      isCreativeOption: input.choice === "D",
      attributesBefore: Object.fromEntries(
        abilities.map((n, i) => [n, before[i]]),
      ),
      attributesAfter: Object.fromEntries(
        abilities.map((n, i) => [n, next.values[i]]),
      ),
      attributeDelta: effects,
    });
    next.choices.push({
      cardId: card.id,
      cardCode: card.card_code,
      choice: input.choice,
      phase: next.phase,
    });
    type = "card_choice";
    if (next.values.includes(0)) {
      next.failures++;
      next.pending = "failure";
    } else if (next.done[next.phase] >= next.counts[next.phase])
      next.pending = "phase";
  } else if (type === "advance") {
    if (!next.pending) throw domainError(409, "阶段尚未完成");
    if (next.pending === "failure") {
      if (next.failures >= 3) throw domainError(409, "已达失败上限，请结算");
      next.values = [3, 3, 3, 3, 3];
      next.done[next.phase] = 0;
    } else {
      const phase = next.counts.findIndex((v, i) => i > next.phase && v > 0);
      if (phase < 0) throw domainError(409, "所有阶段完成，请结算");
      next.phase = phase;
      next.failures = 0;
    }
    next.pending = null;
  } else if (type === "finish") {
    next.ended = true;
    next.endedAt = now;
    next.paused = false;
    type = "game_finish";
    payload.attributes = Object.fromEntries(
      abilities.map((n, i) => [n, next.values[i]]),
    );
  } else throw domainError(400, "不支持的游戏操作");
  next.revision++;
  return { state: next, type, payload };
}
