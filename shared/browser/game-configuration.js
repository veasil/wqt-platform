export const gamePhases = ['启蒙期','成长期','青春期'];

export function validateAgeRange(value) {
  if (value == null || (value.min === '' && value.max === '')) return null;
  const min=Number(value.min),max=Number(value.max);
  if (value.min == null || value.max == null || value.min === '' || value.max === '' ||
    !Number.isInteger(min) || !Number.isInteger(max) || min<0 || max>120 || min>max)
    throw Object.assign(new Error('请填写完整的参与者年龄范围（0–120岁，下限不大于上限）'),{status:400});
  return {min,max};
}

export function validateGameConfiguration(input) {
  const duration=Number(input?.duration),counts=input?.counts,cardGroupId=Number(input?.cardGroupId);
  if (!Number.isSafeInteger(cardGroupId) || cardGroupId<=0) throw Object.assign(new Error('请选择有效卡牌组'),{status:400});
  if (!Number.isInteger(duration) || duration<1 || duration>10800 || !Array.isArray(counts) || counts.length!==3 ||
    !counts.every(n=>Number.isInteger(n)&&n>=0&&n<=15) || !counts.some(n=>n>0))
    throw Object.assign(new Error('请填写有效游戏时长和阶段卡牌数（至少选择一张）'),{status:400});
  return {cardGroupId,mode:String(input.mode||'standard').slice(0,50),duration,counts,ageRange:validateAgeRange(input.ageRange)};
}
