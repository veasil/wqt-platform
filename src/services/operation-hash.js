import {createHash} from 'node:crypto';

// Object key order is transport detail, while array order is business data (players/events).
export function operationHash(value) {
  const canonical=JSON.stringify(value,(_key,item)=>item && typeof item==='object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left],[right])=>left<right ? -1:left>right ? 1:0)):item);
  return createHash('sha256').update(canonical).digest('hex');
}
