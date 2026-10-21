export function sessionSummaryMarkup({session,state,events,scoreOverview}, {escapeHtml:esc,radarMarkup,abilities}) {
  const details=JSON.parse(session.score_details_json||'{}');
  const values=state?.values || (Object.keys(details).length?abilities.map(name=>details[name]?.actual??0):[]);
  const config=JSON.parse(session.game_settings_json||'{}');
  const choices=events.filter(e=>e.type==='card_choice').map(e=>{try{return {ts:e.ts,...JSON.parse(e.payload)}}catch{return null}}).filter(Boolean);
  return `<div class="session-summary-meta"><span>${esc(new Date(Number(session.started_at)).toLocaleString())}</span><span>${session.ended_at?'已结算':'进行中'}</span>${config.ageRange?`<span>参与者年龄 ${esc(config.ageRange.min)}～${esc(config.ageRange.max)} 岁</span>`:''}</div>
    <div class="session-summary-grid"><section class="summary-score"><h3>伍力总览</h3>${values.length===5?radarMarkup(values,scoreOverview||{scoreDetails:details}):'<p>本局未保存伍力分数。</p>'}</section>
    <section class="summary-choices"><h3>选择卡牌 <span class="summary-count">${choices.length}</span></h3>${choices.map(c=>`<details class="summary-choice"><summary><strong>${esc(c.cardCode||'情景卡')}</strong><span>${esc(c.phase||'')} · 选择 ${esc(c.choice)}</span></summary><p>${esc(c.eventText||'')}</p><div class="summary-options">${Object.entries(c.allOptions||{}).map(([key,value])=>`<p class="${key===c.choice?'is-chosen':''}"><b>${esc(key)}</b> ${esc(value?.text||'')}</p>`).join('')}${c.choice==='D'?`<p class="is-chosen"><b>D</b> ${esc(c.optionText||'')}</p>`:''}</div><p>${esc(c.consequence||'')}</p><p class="section-caption">${esc(c.reason||'')}</p></details>`).join('')||'<p class="section-caption">本局尚未选择卡牌。</p>'}</section></div>`;
}

export function surveyFields(questionnaire,answers,esc,{readOnly=false}={}) {
  return questionnaire.questions.map(q=>readOnly?`<div class="submitted-answer"><h3>${esc(q.label)}</h3><p>${esc(answers[q.id]||'—')}</p></div>`:
    `<label>${esc(q.label)}${q.type==='select'?`<select name="${esc(q.id)}" required><option value="">请选择</option>${q.options.map(option=>`<option>${esc(option)}</option>`).join('')}</select>`:`<textarea name="${esc(q.id)}" required maxlength="1000"></textarea>`}</label>`).join('');
}
