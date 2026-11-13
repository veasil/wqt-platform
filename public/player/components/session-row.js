export function sessionRow(item,index,escapeHtml) {
  const esc=escapeHtml,ended=!!item.ended_at;
  return `<article class="list-row session-row" data-session-row="${item.id}">
    <span class="list-icon" aria-hidden="true">${String(index+1).padStart(2,'0')}</span>
    <div class="session-row-info"><h3>${esc(item.activity_name||item.location||'场次 '+item.id)}</h3><p><time>${esc(new Date(Number(item.started_at)).toLocaleString())}</time><span class="status-pill ${ended?'':'live'}">${ended?'已结算':'进行中'}</span></p></div>
    <div class="session-row-actions"><button class="button" data-session-summary="${item.id}">查看本局</button><button class="button" data-session-document="${item.id}" ${ended?'':'disabled'}>复盘文档</button><button class="button" data-session-feedback="${item.id}" ${ended?'':'disabled'}>${item.has_feedback?'查看反馈':'提交反馈'}</button></div>
  </article>`;
}
