export const POWER_NAME_BY_KEY = {
  safety: '安全力',
  reason: '脑波力',
  sense: '实感力',
  creative: '创心力',
  empathy: '沟通力',
};

const clampRate = (value) => Math.max(0, Math.min(1, value));

/**
 * 与旧正式版保持一致：每个维度先除以当前卡牌组的理论满分，再对五个维度的得分率取平均。
 * 不能改回“五项求和 ÷ 50”，因为不同卡牌组的各维度理论满分不同。
 */
export function calculatePowerScore(powers = {}, maxScores = {}) {
  const details = Object.entries(POWER_NAME_BY_KEY).map(([key, name]) => {
    const actual = Number(powers[key]) || 0;
    const max = Number(maxScores?.[name]) || 0;
    const rate = max > 0 ? clampRate(actual / max) : null;
    return { key, name, actual, max, rate };
  });
  const rated = details.filter((item) => item.rate !== null);
  const percent = rated.length
    ? Math.round((rated.reduce((sum, item) => sum + item.rate, 0) / rated.length) * 100)
    : 0;
  return {
    percent,
    details,
    actualTotal: details.reduce((sum, item) => sum + item.actual, 0),
    maxTotal: details.reduce((sum, item) => sum + item.max, 0),
  };
}

export function scoreDetailsObject(powers, maxScores) {
  return Object.fromEntries(calculatePowerScore(powers, maxScores).details.map((item) => [item.name, {
    actual: item.actual,
    max: item.max,
    rate: item.rate === null ? 0 : Math.round(item.rate * 10000) / 10000,
  }]));
}
