import {gamePhases,validateGameConfiguration} from '/shared/browser/game-configuration.js';

// The same field names, defaults and validation serve activity creation and game setup.
export function configurationFields({configuration={},groups=[],modes=[],escapeHtml:esc}) {
  const mode=modes.find(m=>m.id===configuration.mode)||modes[0]||{time:5000,distribution:{}};
  const counts=configuration.counts||gamePhases.map(n=>mode.distribution?.[n]??3);
  const missingGroup=configuration.cardGroupId&&!groups.some(g=>Number(g.id)===Number(configuration.cardGroupId));
  return `<div class="form-grid game-configuration-fields">
    <fieldset class="age-field"><legend>参与者年龄</legend><span class="age-range"><input name="ageMin" aria-label="参与者最小年龄" type="number" min="0" max="120" value="${esc(configuration.ageRange?.min??'')}"><span>～</span><input name="ageMax" aria-label="参与者最大年龄" type="number" min="0" max="120" value="${esc(configuration.ageRange?.max??'')}"><span>岁</span></span></fieldset>
    <label>卡牌组<select name="group" required>${missingGroup?'<option value="" disabled selected>原卡牌组不可用，请重新选择</option>':''}${groups.map(g=>`<option value="${g.id}" ${(configuration.cardGroupId?Number(configuration.cardGroupId)===Number(g.id):g.is_default)?'selected':''}>${esc(g.name)}</option>`).join('')}</select></label>
    <label>游戏模式<select name="mode">${(modes.length?modes:[{id:'standard',name:'标准模式'}]).map(m=>`<option value="${esc(m.id)}" ${m.id===configuration.mode?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label>
    <label>游戏时长（秒）<input name="duration" type="number" min="1" max="10800" required value="${esc(configuration.duration??mode.time??5000)}"></label>
    ${gamePhases.map((name,i)=>`<label>${name}卡牌数<input name="count${i}" type="number" min="0" max="15" required value="${counts[i]}"></label>`).join('')}
  </div>`;
}
export function bindConfiguration(form,modes) {
  form.elements.mode.onchange=()=>{
    const mode=modes.find(m=>m.id===form.elements.mode.value);
    if(mode){form.elements.duration.value=mode.time;gamePhases.forEach((n,i)=>form.elements['count'+i].value=mode.distribution?.[n]??3)}
  };
}
export function readConfiguration(form) {
  const f=new FormData(form);
  return validateGameConfiguration({cardGroupId:Number(f.get('group')),mode:f.get('mode'),duration:Number(f.get('duration')),
    counts:[0,1,2].map(i=>Number(f.get('count'+i))),ageRange:{min:f.get('ageMin'),max:f.get('ageMax')}});
}
