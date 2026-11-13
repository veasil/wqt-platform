// Work only with the already authorized operations snapshot. Never serialize raw rows.
export const organizationLevels = {personal:'个人级',group:'小组级',city:'城市级'}
const categoryNames = {free:'免费用户',trial:'体验中用户',entitled:'有权益用户',organization_admin:'组织管理员',platform_admin:'平台管理员'}
const statusName = value => value === 'active' ? '正常' : '已停用'
const dateText = value => value == null ? '' : new Date(Number(value)).toISOString()
const includesQuery = (values, query) => values.join(' ').toLowerCase().includes(query.trim().toLowerCase())

export function filterOrganizations(rows, {query='', level='', entitlement='entitled'}={}) {
  return rows.filter(row => (!level || row.plan === level) &&
    (!entitlement || (entitlement === 'entitled' ? row.entitled : !row.entitled)) &&
    includesQuery([row.id,row.name,row.location,organizationLevels[row.plan]], query))
}
export function filterUsers(rows, {query='', level='', category=''}={}) {
  return rows.filter(row => (!category || row.categories.includes(category)) &&
    (!level || row.accounts.some(account => account.plan === level)) &&
    includesQuery([row.id,row.guardian_name,row.real_name,row.phone,...row.accounts.flatMap(account => [account.organization_name,account.location])], query))
}

export function csvCell(value) {
  let text = String(value ?? '')
  // Spreadsheet programs may evaluate formulas even when a CSV field is quoted.
  if (/^[\s\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`
  return `"${text.replaceAll('"','""')}"`
}
const csv = rows => '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
export function organizationsCsv(rows) {
  return csv([['组织ID','组织名称','地点','组织级别','状态','组织权益有效','权益到期时间（UTC）','账号数量','已绑定账号','用户人数','在线人数'],
    ...rows.map(row => [row.id,row.id===0 ? '免费组织':row.name,row.location,organizationLevels[row.plan] || '无付费级别',statusName(row.status),row.entitled ? '是':'否',dateText(row.subscription_until),row.current_members,row.bound_accounts,row.user_count,row.online_users])])
}
export function usersCsv(rows) {
  return csv([['用户ID','真实姓名','守望师名','手机号','状态','用户分类','绑定账号数','所属组织','在线状态'],
    ...rows.map(row => [row.id,row.real_name,row.guardian_name,row.phone,statusName(row.status),row.categories.map(value => categoryNames[value] || value).join('、'),row.accounts.length,[...new Set(row.accounts.map(account => account.organization_name))].join('、'),row.online ? '在线':'离线'])])
}
export function downloadCsv(filename, content) {
  const url = URL.createObjectURL(new Blob([content], {type:'text/csv;charset=utf-8;'}))
  const link = document.createElement('a')
  link.href = url; link.download = filename; document.body.appendChild(link)
  try {link.click()} finally {link.remove();setTimeout(() => URL.revokeObjectURL(url),1000)}
}
