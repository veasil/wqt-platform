// Presentation only: the backend remains authoritative for resend limits.
// Deadlines survive view changes/reloads; credentials and SMS codes are never stored.
export function createSmsCooldown(onChange) {
  let phone = '', timer, last;
  const deadlines = new Map();
  const key = value => 'WQT_SMS_RESEND:' + value;
  const normalize = value => String(value || '').replace(/\D/g, '');
  function deadline(value) {
    try { return Math.max(deadlines.get(value) || 0, Number(sessionStorage.getItem(key(value))) || 0); }
    catch { return deadlines.get(value) || 0; }
  }
  function tick() {
    const seconds = phone ? Math.max(0, Math.ceil((deadline(phone) - Date.now()) / 1000)) : 0;
    if (seconds !== last) { last = seconds; onChange(seconds); }
    if (!seconds) {
      clearInterval(timer); timer = undefined;
      deadlines.delete(phone);
      try { sessionStorage.removeItem(key(phone)); } catch { /* Storage is optional. */ }
    }
  }
  function select(value) {
    phone = normalize(value); last = undefined;
    clearInterval(timer); timer = undefined; tick();
    if (last > 0) timer = setInterval(tick, 250);
  }
  function start(value, seconds) {
    value = normalize(value);
    if (!value || !Number.isFinite(Number(seconds)) || Number(seconds) < 0) return;
    const until = Date.now() + Math.ceil(Number(seconds)) * 1000;
    deadlines.set(value, until);
    try { sessionStorage.setItem(key(value), String(until)); } catch { /* In-memory fallback. */ }
    if (value === phone) select(phone);
  }
  return { select, start, dispose() { clearInterval(timer); timer = undefined; } };
}
