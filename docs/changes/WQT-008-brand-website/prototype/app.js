/* Standalone visual prototype: no API calls, analytics or input persistence. */
const powers = {
  R: {name:'安全力',en:'POWER R / SAFETY',description:'面对数字世界的风险，学会辨识、保护自己，并知道何时寻求帮助。',note:'先看清风险，再做出选择。'},
  A: {name:'脑波力',en:'POWER A / THINKING',description:'面对信息与技术，保持好奇与思考，尝试理解信息背后的理由。',note:'多问一步，也多想一步。'},
  S: {name:'实感力',en:'POWER S / AWARENESS',description:'留意自己的情绪与身体感受，在数字体验中保持与真实生活的连接。',note:'看见世界，也感受自己。'},
  P: {name:'创心力',en:'POWER P / CREATIVITY',description:'把想法变成新的尝试，在情境中探索不同的解决方式。',note:'用自己的想法，创造新的可能。'},
  E: {name:'沟通力',en:'POWER E / COMMUNICATION',description:'清楚地表达，也认真地倾听，在交流中理解彼此的选择。',note:'让表达与倾听，一起发生。'}
};
const partners = {
  school: {en:'FOR SCHOOLS & INSTITUTIONS',title:'让数智教育，\n从一次共同体验开始。',description:'围绕学校与机构的教育目标，探讨桌游体验、活动组织与陪伴者参与方式。',topics:['适合怎样的学习与活动场景？','如何组织一次有讨论、有复盘的体验？','教师与陪伴者如何参与？'],cta:'讨论教育场景合作',context:'期待了解您的教育目标与活动场景，一起讨论产品与体验合作。'},
  enterprise: {en:'FOR ENTERPRISES & PARTNERS',title:'连接企业的行动，\n与下一代的成长。',description:'从企业的社会责任、员工家庭活动或产业资源出发，讨论与数智教育相连接的合作议题。',topics:['企业关注哪些教育与成长议题？','哪些资源可以与体验活动相连接？','如何明确合作范围与双方责任？'],cta:'讨论企业合作方向',context:'期待了解您的企业目标与可连接的资源，一起讨论合作方向。'},
  capital: {en:'FOR CAPITAL & LONG-TERM PARTNERS',title:'从具体产品出发，\n交流长期发展的可能。',description:'围绕现有产品、服务场景与发展方向展开交流；进一步的业务与资方材料可在沟通中确认。',topics:['产品正在解决怎样的具体问题？','现有场景与后续发展方向是什么？','哪些材料适合进一步交流？'],cta:'开启资方交流',context:'欢迎围绕产品、场景与长期发展展开交流，进一步材料可在沟通中确认。'}
};
const params = new URLSearchParams(location.search);
function updateParam(key,value){const url=new URL(location.href);url.searchParams.set(key,value);history.replaceState(null,'',url);}
function animateSwap(element){if(!element)return;element.classList.remove('swap-in');requestAnimationFrame(()=>element.classList.add('swap-in'));}
function selectPower(key, sync=true){
  if(!powers[key]||!document.querySelector('#power-name'))return;
  const power=powers[key];
  document.querySelectorAll('[data-power]').forEach(button=>{const selected=button.dataset.power===key;button.classList.toggle('is-selected',selected);button.setAttribute('aria-pressed',String(selected));});
  document.querySelector('#power-code').textContent=key;
  document.querySelector('#power-code').style.color=`var(--${key.toLowerCase()})`;
  document.querySelector('#power-en').textContent=power.en;
  document.querySelector('#power-name').textContent=power.name;
  document.querySelector('#power-description').textContent=power.description;
  document.querySelector('.detail-note').textContent=power.note;
  if(sync)updateParam('power',key);
  animateSwap(document.querySelector('.power-detail'));
}
function selectPartner(key,sync=true){
  if(!partners[key]||!document.querySelector('#partner-title'))return;
  const partner=partners[key];
  document.querySelectorAll('[data-partner]').forEach(button=>{const selected=button.dataset.partner===key;button.classList.toggle('is-selected',selected);button.setAttribute('aria-pressed',String(selected));});
  document.querySelector('#partner-en').textContent=partner.en;
  const title=document.querySelector('#partner-title');title.replaceChildren();
  partner.title.split('\n').forEach((line,index)=>{if(index)title.append(document.createElement('br'));title.append(document.createTextNode(line));});
  document.querySelector('#partner-description').textContent=partner.description;
  const list=document.querySelector('#partner-topics');list.replaceChildren();partner.topics.forEach(text=>{const li=document.createElement('li');li.textContent=text;list.append(li);});
  const cta=document.querySelector('#partner-cta');cta.dataset.audience=key;cta.replaceChildren(document.createTextNode(partner.cta+' '));const arrow=document.createElement('span');arrow.setAttribute('aria-hidden','true');arrow.textContent='↗';cta.append(arrow);
  if(sync)updateParam('partner',key);
  animateSwap(document.querySelector('.partner-content'));
}
document.querySelectorAll('[data-power]').forEach(button=>button.addEventListener('click',()=>selectPower(button.dataset.power)));
document.querySelectorAll('[data-partner]').forEach(button=>button.addEventListener('click',()=>selectPartner(button.dataset.partner)));
selectPower(params.get('power')||'R',false);selectPartner(params.get('partner')||'school',false);
const menu=document.querySelector('.menu-toggle');const nav=document.querySelector('#site-nav');
function closeMenu(){if(!menu)return;menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','展开导航');nav.classList.remove('is-open');}
menu?.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'关闭导航':'展开导航');nav.classList.toggle('is-open',open);});
nav?.querySelectorAll('a,button').forEach(element=>element.addEventListener('click',closeMenu));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu?.getAttribute('aria-expanded')==='true'){closeMenu();menu.focus();}});
matchMedia('(min-width:801px)').addEventListener('change',closeMenu);
const dialog=document.querySelector('#contact-dialog');let opener;
document.querySelectorAll('[data-contact]').forEach(button=>button.addEventListener('click',()=>{if(!dialog)return;opener=button;document.querySelector('#contact-context').textContent=partners[button.dataset.audience]?.context||'关注伍仟天，了解产品与合作方向。';dialog.showModal();}));
dialog?.querySelector('[data-close]')?.addEventListener('click',()=>dialog.close());
dialog?.addEventListener('keydown',event=>{
  if(event.key!=='Tab')return;
  const controls=[...dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].filter(element=>element.getClientRects().length);
  if(!controls.length)return;
  const first=controls[0],last=controls[controls.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
});
dialog?.addEventListener('close',()=>{if(opener?.getClientRects().length)opener.focus();else menu?.focus();});
dialog?.addEventListener('click',event=>{if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();});
document.querySelectorAll('img[src$="wechat.png"]').forEach(img=>img.addEventListener('error',()=>{const text=document.createElement('p');text.className='notice error';text.textContent='二维码暂时无法显示，请稍后重新打开此页面。';img.replaceWith(text);}));

const demoForm=document.querySelector('#demo-form');
if(demoForm){
  const email=demoForm.querySelector('#demo-email');const error=document.querySelector('#demo-email-error');const status=document.querySelector('#demo-status');const submit=demoForm.querySelector('button[type="submit"]');let timeout;
  function clearError(){email.removeAttribute('aria-invalid');error.hidden=true;}
  email.addEventListener('input',()=>{clearError();status.hidden=true;});
  demoForm.addEventListener('submit',event=>{event.preventDefault();clearTimeout(timeout);status.hidden=true;if(!email.value.trim()||!email.validity.valid){email.setAttribute('aria-invalid','true');error.hidden=false;email.focus();return;}clearError();submit.disabled=true;submit.setAttribute('aria-busy','true');submit.textContent='演示处理中…';timeout=setTimeout(()=>{submit.disabled=false;submit.removeAttribute('aria-busy');submit.textContent='演示提交状态';status.hidden=false;status.className='notice success';status.textContent='演示完成。输入没有发送，也没有保存。';},900);});
  demoForm.addEventListener('reset',()=>{clearTimeout(timeout);clearError();status.hidden=true;submit.disabled=false;submit.removeAttribute('aria-busy');submit.textContent='演示提交状态';});
}
document.querySelector('#play-motion')?.addEventListener('click',()=>{const block=document.querySelector('.motion-block');block.classList.remove('playing');requestAnimationFrame(()=>requestAnimationFrame(()=>block.classList.add('playing')));});
