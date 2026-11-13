export const plans = {
  personal: { label: '个人合伙人', count: 1 },
  group: { label: '团队合伙人', count: 5 },
  city: { label: '城市合伙人', count: 20 }
}
export function accountEntitlement(account) {
  if (account.available === false) return '已停用'
  const partner=plans[account.plan]?.label
  if (account.paid_valid) return partner ? `${partner}旗下权益` : '组织旗下权益'
  if (account.trial_valid) return '体验中'
  if (partner && account.entitlement_until!=null && Number(account.entitlement_until)<=Date.now()) return `${partner}旗下权益（已到期）`
  return account.entitlement || '免费权益'
}
export function addYear(timestamp) {
  const date = new Date(timestamp), month = date.getUTCMonth()
  date.setUTCFullYear(date.getUTCFullYear() + 1)
  if (date.getUTCMonth() !== month) date.setUTCDate(0)
  return date.getTime()
}
export const renewalUntil = (until, now = Date.now()) => addYear(Math.max(Number(until), now))
export const formatTime = value => value == null ? '—' : new Date(Number(value)).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',hour12:false})

// Only these nonsensitive operations survive a reload. Passwords and SMS never enter storage.
const recoverable = new Set(['/api/admin/subscriptions','/api/admin/subscriptions/renew','/api/admin/account-bindings','/api/admin/status',
  '/api/admin/trials/activate','/api/admin/invite-codes','/api/admin/organizations/update-info','/api/admin/identities/update-profile','/api/admin/identities/revoke-session'])
const canRecover = path => recoverable.has(path) || /^\/api\/admin\/activities(?:\/\d+)?$/.test(path)
export function createOperationClient({post, storage, actor, scope='delivery', randomId = () => crypto.randomUUID()}) {
  const key = `aw_pending_operation:${actor.identityId}:${actor.accountId}:${scope}`
  let pending = null
  let flight = null
  try {
    const saved = JSON.parse(storage.getItem(key) || 'null')
    if (saved && canRecover(saved.path) && typeof saved.requestId === 'string' && saved.body && typeof saved.body === 'object') pending = saved
  } catch { storage.removeItem(key) }
  function clear() { pending = null; storage.removeItem(key) }
  async function execute(path, body) {
    const fingerprint = JSON.stringify([path, body])
    if (pending && JSON.stringify([pending.path,pending.body]) !== fingerprint) throw new Error('上一笔操作结果尚未确认，请先重试原操作')
    if (flight) return flight
    if (!pending) {
      pending = {path,body:structuredClone(body),requestId:randomId()}
      if (canRecover(path)) storage.setItem(key,JSON.stringify(pending))
    }
    const current = pending
    flight = (async()=>{
      try {
        const result = await post(path,{...current.body,requestId:current.requestId})
        clear()
        return result
      } catch(e) {
        // An auth rejection after an uncertain write does not prove it never committed.
        if (e.response?.status >= 400 && e.response.status < 500 && !current.uncertain) clear()
        else {
          current.uncertain=true
          if (canRecover(path)) storage.setItem(key,JSON.stringify(current))
        }
        throw e
      }
    })()
    try {return await flight} finally {flight=null}
  }
  return { execute, retry: () => pending ? execute(pending.path,pending.body) : Promise.resolve(null), get pending() {return pending} }
}
