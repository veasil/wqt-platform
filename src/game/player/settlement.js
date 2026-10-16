import {cardsDbGet,cardsDbAll} from '../../cards-db.js';
import {abilities} from './state.js';
export async function playerScore(session,values){
 const group=session.card_group_id?await cardsDbGet('SELECT max_scores_json,released_ids_json FROM card_groups WHERE id=?',[session.card_group_id]):null;
 const snapshot=JSON.parse(session.game_settings_json||"{}").cardSnapshot;
 const max=!snapshot&&group?.max_scores_json?JSON.parse(group.max_scores_json):{};
 if(snapshot||group&&!group.max_scores_json){const ids=snapshot?.releasedIds||JSON.parse(group.released_ids_json||'[]');if(ids.length){const rows=await cardsDbAll('SELECT options_json FROM cards_released WHERE id IN ('+ids.map(()=>'?').join(',')+')',ids);for(const row of rows){const options=Object.values(JSON.parse(row.options_json));for(const name of abilities)max[name]=(max[name]||0)+Math.max(0,...options.map(o=>Number(o.attributeEffects?.[name]||0)))}}}
 const details={};let total=0;abilities.forEach((name,i)=>{const actual=values[i],maximum=Number(max[name]||0),rate=maximum>0?Math.min(actual/maximum,1):0;details[name]={actual,max:maximum,rate};total+=rate});return {finalScore:Math.round(total/abilities.length*100),scoreDetails:details};
}
