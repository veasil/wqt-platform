// Keep technical details in diagnostics; show people an actionable recovery message.
export function userErrorMessage(error) {
  if (error?.outcomeUnknown) return '提交结果尚未确认，请先核对最新记录；不要直接重复提交。';
  if (error?.code === 'REQUEST_CANCELLED') return '本次操作已取消。';
  if (error?.code === 'RESPONSE_INVALID') return '收到的数据格式不完整，页面暂时无法继续，请稍后重试。';
  if (error?.status >= 500) return '服务暂时无法完成此操作，请稍后重试。';
  if (error?.status === 0) return '连接暂时未能完成，请检查网络后重试。';
  if (['TypeError', 'ReferenceError', 'SyntaxError'].includes(error?.name)) {
    return '页面暂时未能完成此操作，请重试；若仍失败，请刷新页面后再试。';
  }
  return typeof error?.message === 'string' && error.message.trim()
    ? error.message
    : '操作暂未完成，请重试。';
}

// These are local triage hints, not proof of a site-wide incident.
export function classifyFault(error, { unhandled = false } = {}) {
  const message = userErrorMessage(error);
  if (error?.outcomeUnknown) return {
    code: 'WQT-WRITE-UNKNOWN', severity: 'P1', label: '优先核对', type: '提交结果待确认', message,
    impact: '服务器可能已经处理提交，当前页面未能确认结果。',
    recovery: '先查看最新场次或操作记录；若有“重试未确认操作”，使用该入口保留原操作编号。不要另建一笔重复提交。'
  };
  if (unhandled) return {
    code: 'WQT-JS-UNHANDLED', severity: 'P1', label: '优先核对', type: '页面运行异常',
    message: '页面遇到异常，当前操作状态需要核对。',
    impact: '有程序异常未被当前功能接住；尚不能判断其他功能或其他用户是否受影响。',
    recovery: '先核对刚才的操作结果；保留未保存内容和录音，再决定是否刷新。可复制下方信息交给支持人员。'
  };
  if (error?.code === 'RESPONSE_INVALID') return {
    code: 'WQT-RESPONSE-INVALID', severity: 'P2', label: '局部故障', type: '响应格式异常', message,
    impact: '当前功能收到的数据无法使用；保留当前页面，不把缺失数据当成空记录。',
    recovery: '稍后重新读取；若反复出现，请提供故障信息。'
  };
  if (error?.status === 0 && error?.code !== 'REQUEST_CANCELLED') return {
    code: 'WQT-CONNECTION', severity: 'P2', label: '局部故障', type: '连接未完成', message,
    impact: '当前请求未完成，不能仅凭此判断网站整体故障或网络拦截原因。',
    recovery: '检查网络后重新读取；可换一个可信网络对比。'
  };
  if (error?.status >= 500) return {
    code: 'WQT-SERVICE', severity: 'P2', label: '局部故障', type: '服务响应异常', message,
    impact: '本次请求未得到可用结果；整体影响范围尚未确定。',
    recovery: '稍后重试；持续出现时提供故障信息。'
  };
  if (['TypeError', 'ReferenceError', 'SyntaxError'].includes(error?.name)) return {
    code: 'WQT-JS-CAUGHT', severity: 'P2', label: '局部故障', type: '页面处理异常', message,
    impact: '当前功能未正常结束。此提示不能证明此前的提交未保存。',
    recovery: '先核对刚才的操作结果，再尝试恢复；刷新前保存未提交内容和录音。'
  };
  if ((error?.status >= 400 && error.status < 500 && error.status !== 408) || ['BUSINESS_RULE', 'REQUEST_CANCELLED'].includes(error?.code)) return {
    code: 'WQT-ACTION-NOTICE', severity: 'P3', label: '操作提示', type: '操作条件未满足', message,
    impact: '输入、登录、权限、频率或当前状态需要处理；通常不属于程序事故。',
    recovery: '先按提示处理；若符合条件仍反复受阻，请提供故障信息。'
  };
  return {
    code: 'WQT-UNKNOWN', severity: 'P2', label: '待定位', type: '未分类的操作异常', message,
    impact: '当前证据不足以确定原因或影响范围，不据此认定数据已丢失。',
    recovery: '先核对操作结果；持续出现时提供故障信息，不反复提交未确认的写入。'
  };
}

export function faultRecord(fault, error, context = {}) {
  const views = ['entry', 'login', 'accounts', 'activities', 'setup', 'game', 'ended', 'me', 'downloads'];
  return {
    reference: globalThis.crypto?.randomUUID?.() || 'local-' + Math.random().toString(16).slice(2, 10),
    code: fault.code,
    severity: fault.severity,
    occurredAt: new Date().toISOString(),
    view: views.includes(context.view) ? context.view : 'other',
    source: ['caught', 'error', 'rejection'].includes(context.source) ? context.source : 'caught',
    httpStatus: Number.isInteger(error?.status) ? error.status : null,
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(error?.requestMethod) ? error.requestMethod : null
  };
}

export function createFaultDetails(fault, record) {
  const details = document.createElement('details');
  details.className = 'fault-details';
  details.dataset.severity = fault.severity;
  const summary = document.createElement('summary');
  summary.textContent = `故障说明 · ${fault.severity} ${fault.label}`;
  details.append(summary);
  for (const text of [`类型：${fault.type}`, `影响：${fault.impact}`, `建议：${fault.recovery}`, `故障代码：${fault.code}`]) {
    const line = document.createElement('p'); line.textContent = text; details.append(line);
  }
  const info = document.createElement('textarea');
  info.readOnly = true;
  info.setAttribute('aria-label', '可复制的故障信息');
  info.value = JSON.stringify(record, null, 2);
  info.onfocus = () => info.select();
  const copy = document.createElement('button');
  copy.type = 'button'; copy.className = 'button'; copy.textContent = '复制故障信息';
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(info.value);
      status.textContent = '已复制，可粘贴给支持人员。';
    } catch {
      info.focus(); info.select();
      status.textContent = '自动复制暂不可用，请手动复制已选中的信息。';
    }
  };
  details.append(info, copy, status);
  return details;
}
