import { request } from "./api.js";
import { createSmsCooldown } from "/shared/browser/sms-cooldown.js";
let disposeSmsCooldown = () => {};
import { attachFrame } from "./refined-frame.js";
import { attachReflections } from "./refined-reflections.js";
let loginActivityCode="";
let autoEnding=false,practice=false,narration=null,lastFeedback=null,scoreOverview=null,loginSession=null;
let disposeFrame = () => {},
  disposeReflection = () => {};
let recorder = null,
  stream = null,
  audioBlob = null,
  audioContext = null,
  audioSaving = false;
let audioDraftWarning = "", audioDraftPersisted = false;
// Only stopped recordings are durable. Tokens are never written to this database.
function audioDraftDatabase() {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open("WQT_PLAYER_AUDIO", 1);
    let expired = false;
    const timeout = setTimeout(() => { expired = true; reject(new Error("本机录音暂存超时")); }, 3000);
    opening.onupgradeneeded = () => opening.result.createObjectStore("drafts", { keyPath: "identityId" });
    opening.onsuccess = () => { clearTimeout(timeout); if (expired) opening.result.close(); else resolve(opening.result); };
    opening.onerror = () => { clearTimeout(timeout); reject(opening.error); };
    opening.onblocked = () => { clearTimeout(timeout); expired = true; reject(new Error("本机录音暂存被其他页面占用")); };
  });
}
async function audioDraftTransaction(mode, work) {
  const db = await audioDraftDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("drafts", mode);
      const result = work(tx.objectStore("drafts"));
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("录音暂存未完成"));
    });
  } finally { db.close(); }
}
async function persistAudioDraft() {
  const context = audioContext, blob = audioBlob;
  try {
    await audioDraftTransaction("readwrite", store => store.add({ ...context, blob }));
    audioDraftPersisted = true;
    audioDraftWarning = "录音已暂存到本机，使用同一身份登录可恢复。";
  } catch {
    audioDraftWarning = "本机暂存不可用或已有其他未处理录音，请立即下载本地副本；刷新可能丢失本次录音。";
  }
}
async function restoreAudioDraft() {
  const identityId = user?.identityId;
  if (audioContext?.identityId !== identityId) { audioBlob = null; audioContext = null; audioDraftWarning = ""; audioDraftPersisted = false; }
  if (!identityId || audioBlob) return;
  try {
    const draft = await audioDraftTransaction("readonly", store => store.get(identityId));
    if (user?.identityId !== identityId || !draft?.blob) return;
    const { blob, ...context } = draft;
    audioBlob = blob; audioContext = context;
    audioDraftPersisted = true;
    audioDraftWarning = "已恢复本机未保存录音；上传前请切换到录音原账号。";
  } catch { audioDraftWarning = "本机录音暂存不可用，停止录音后请下载本地副本。"; }
}
async function deleteAudioDraft(context) {
  await audioDraftTransaction("readwrite", store => {
    const read = store.get(context.identityId);
    read.onsuccess = () => { if (read.result?.draftId === context.draftId) store.delete(context.identityId); };
  });
}
async function clearAudioDraft(context = audioContext, persisted = audioDraftPersisted) {
  try { if (persisted) await deleteAudioDraft(context); }
  catch { throw new Error("无法清除本机暂存，请重试；录音仍保留。"); }
  if (audioContext?.draftId === context.draftId) {
    audioBlob = null; audioContext = null; audioDraftWarning = ""; audioDraftPersisted = false;
  }
}
const $ = (s) => document.querySelector(s),
  root = $("#player-content"),
  names = ["安全力", "脑波力", "实感力", "创心力", "沟通力"],
  phases = ["启蒙期", "成长期", "青春期"];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let user = null,
  account = null,
  accounts = [],
  settings = {},
  cards = [],
  groups = [],
  activity = null,
  session = null,
  state = null,
  events = [],
  card = null,
  selected = null,
  view = "entry",
  generation = 0,
  aiController = null,
  pending = [],
  busy = false;
const button = (text, id, primary = false) =>
  `<button class="button ${primary ? "primary" : ""}" id="${id}">${text}</button>`;
const note = (text) => `<p class="scope-note">${text}</p>`;
const formField = (name, label, value = "", attrs = "") =>
  `<label>${label}<input name="${name}" value="${esc(value)}" ${attrs}></label>`;
function show(name, html) {
  disposeSmsCooldown();
  const previousView=view, scrollY=window.scrollY;
  const timelineScroll=$(".operation-timeline")?.scrollTop||0;
  generation++;
  aiController?.abort();
  narration?.pause();
  window.speechSynthesis?.cancel();
  disposeFrame();
  disposeReflection();
  view = name;
  root.innerHTML = html;
  root.focus({ preventScroll: true });
  root.dataset.view=name;
  if(previousView===name){requestAnimationFrame(()=>{window.scrollTo({top:scrollY,behavior:"instant"});const timeline=$(".operation-timeline");if(timeline)timeline.scrollTop=timelineScroll;});}
  document
    .querySelectorAll(".nav button")
    .forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
  $(".nav").hidden = !user;
  syncIdentity();
  bind('skill-fold',()=>{const b=$('#skill-fold'),expanded=b.getAttribute('aria-expanded')!=='true';b.setAttribute('aria-expanded',String(expanded));b.closest('.rail-card').classList.toggle('skills-expanded',expanded);b.querySelector('span').textContent=expanded?'收起':'展开'});
  const reader = root.querySelector(".reader");
  if (reader) {
    disposeFrame = attachFrame(reader);
    disposeReflection = attachReflections(reader);
  }
}
function surface(title, body) {
  return `<section class="flow-surface"><h1>${title}</h1>${body}</section>`;
}
function emptyPanel(title,copy,icon='◇'){return `<div class="empty-state"><span class="empty-state-icon" aria-hidden="true">${icon}</span><h3>${esc(title)}</h3><p>${esc(copy)}</p></div>`}
function loadingPanel(){return '<div class="content-loading" role="status"><span class="loading-orbit" aria-hidden="true"></span><p>正在读取内容</p><div class="loading-lines" aria-hidden="true"><i></i><i></i><i></i></div></div>'}
function formatSize(bytes){const n=Number(bytes)||0;return n<1024?n+' B':n<1024*1024?(n/1024).toFixed(1)+' KB':(n/1024/1024).toFixed(1)+' MB'}
function alertError(error){
 const el=$('#dialog-error')||$('#page-error');if(el)el.textContent=error.message;else window.alert(error.message);
 const loading=$('.content-loading');if(loading){if(el)el.textContent='';loading.outerHTML='<div class="content-error" role="alert">'+emptyPanel('内容暂时无法读取',error.message)+'<button class="button" id="retry-content">重新读取</button></div>'; const content=$('#account-content');if(content)content.dataset.ready='true';bind('retry-content',()=>view==='me'?me(root.dataset.accountTab||'profile'):downloads())}
}
async function safe(work) {
  try {
    await work();
  } catch (e) {
    alertError(e);
  }
}
function bind(id, work) {
  const el = $("#" + id);
  if (el) el.onclick = () => safe(work);
}
function syncIdentity() {
  const name = account?.name || user?.guardianName || "未登录";
  const visibleAudio = audioBlob && audioContext?.identityId === user?.identityId;
  $(".identity").innerHTML =
    `<button id="identity-menu" class="identity-button">${esc(name)}</button>${state && !state.ended ? `<button id="record-button" class="button">${recorder?.state === "recording" ? "● 录音中" : "录音未开启"}</button>` : ""}${visibleAudio ? `<button id="pending-audio" class="button">待保存录音 · 场次 ${esc(audioContext.sessionId)}</button>` : ""}${user && account && sessionStorage.getItem(operationKey()) ? '<button id="retry-operation" class="button">重试未确认操作</button>' : ""}${pending.length ? `<button id="pending-feedback" class="feedback-pending">反馈 ${pending.length}</button>` : ""}`;
  const meNav = $("#nav-me");
  meNav.classList.toggle("has-pending-feedback", pending.length > 0);
  meNav.setAttribute("aria-label", pending.length ? `我的，${pending.length} 场待完成反馈` : "我的");
  bind("identity-menu", () => (user ? me() : login()));
  bind("record-button", recordPanel);
  bind("pending-audio", recordPanel);
  bind("pending-feedback", () => me("feedback"));
  bind("retry-operation", async () => {
    const op = JSON.parse(sessionStorage.getItem(operationKey()));
    await write(op.path, op.body);
    await restore();
  });
}
$(".reviewbar")?.remove();
const themeToggle=document.createElement('button');themeToggle.id='theme-toggle';themeToggle.className='theme-toggle';
document.querySelector('header').append(themeToggle);
function syncThemeToggle(){
 const light=document.documentElement.dataset.theme==='light';
 themeToggle.innerHTML=light?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/></svg>';
 themeToggle.title=light?'切换暗版':'切换亮版';themeToggle.setAttribute('aria-label',themeToggle.title);
}
themeToggle.onclick=()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='light'?'dark':'light'};
new MutationObserver(syncThemeToggle).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});syncThemeToggle();
const headerElement=document.querySelector('header');const syncHeaderHeight=()=>document.documentElement.style.setProperty('--player-header-height',headerElement.getBoundingClientRect().height+'px');new ResizeObserver(syncHeaderHeight).observe(headerElement);syncHeaderHeight();
$(".nav").innerHTML =
  '<button data-nav="game" id="nav-game">桌游模式</button><button data-nav="watch" id="nav-watch">监督模式</button><button data-nav="me" id="nav-me">我的</button><button data-nav="downloads" id="nav-downloads">↓ 下载中心</button>';
bind("nav-game", () => (state ? game() : activities()));
bind("nav-watch", watch);
bind("nav-me", me);
bind("nav-downloads", downloads);
async function loadSettings() {
  const data = await request("/api/settings");
  if (data.accountModel !== "accounts")
    throw new Error("新版需要已配置的账号模式，请使用现有系统入口");
  settings = Object.fromEntries(data.settings.map((x) => [x.key, x.value]));
  const list = await request("/api/card-groups");
  groups = list.groups || [];
}
function entry() {
  show(
    "entry",
    `<div class="flow-hero"><div><p class="flow-kicker">数智免疫力桌游</p><h1>每一次选择，<br>都是成长的练习。</h1><p class="flow-lead">由守望者带领，让风险被看见，让成长有迹可循。</p>${button("进入守望者系统　↗", "enter", true)}</div><div class="hero-emblem" id="brand-resource"><img src="brand-references/product-logo.png" alt="伍力全开"><span>一起探索 · 一起守护</span></div></div><p id="page-error" role="alert"></p>`,
  );
  bind("enter", login);
  refreshBrand();
}
async function refreshBrand() {
  const el = $("#brand-resource");
  if(!el)return;
  try {
    const data = await request("/api/public/brand-resource", { token: null });
    const url=new URL(data.image,location.origin);
    if(url.origin!==location.origin)return;
    url.searchParams.set('revision',data.revision || 'default');
    if(el.dataset.revision===data.revision&&el.querySelector('img')?.src===url.href)return;
    const image=new Image();image.src=url.href;await image.decode();
    if(el.isConnected&&el===$("#brand-resource")){
      el.innerHTML = `<img src="${esc(url.href)}" alt="${esc(data.alt)}"><span>${esc(data.title)}</span>`;
      el.dataset.revision=data.revision;
    }
  } catch {
    /* retain last image */
  }
}
function login(mode = "password") {
  show(
    "login",
    surface(
      "欢迎回来，守望者",
      `<div class="auth-tabs"><button id="auth-password">账号密码登录</button><button id="auth-sms">账号验证码登录</button><button disabled title="暂未开放">微信登录 · 待接入</button></div><form id="auth-form" class="flow-form">${formField("phone", "手机号", "", 'type="tel" required autocomplete="username"')}${mode === "password" ? formField("password", "密码", "", 'type="password" required autocomplete="current-password"') : `<label>短信验证码<div class="code-entry"><input name="smsCode" required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"><button type="button" id="send-code" class="button">获取验证码</button></div></label><p class="sms-status" id="sms-status" role="status"></p>`}<p id="page-error" role="alert"></p><button class="button primary">登录</button></form><div class="auth-links"><a href="/register.html">邀请码注册 / 绑定账号</a><a href="/reset-password.html">忘记密码</a></div>`,
    ),
  );
  $(mode==="password"?"#auth-password":"#auth-sms").classList.add("active");
  $(mode==="password"?"#auth-password":"#auth-sms").setAttribute("aria-current","true");
  bind("auth-password", () => login());
  bind("auth-sms", () => login("sms"));
  if (mode === 'sms') {
   const form = $('#auth-form'), b = $('#send-code'), status = $('#sms-status');
   let sending = false, remaining = 0, waiting = false, retry = false;
   const render = seconds => {
    remaining = seconds; b.disabled = sending || seconds > 0;
    b.textContent = seconds > 0 ? seconds + '秒后重发' : retry ? '重新获取' : '获取验证码';
    if (waiting) status.textContent = seconds > 0 ? `请等待 ${seconds} 秒后重试` : '现在可以重新获取验证码';
   };
   const cooldown = createSmsCooldown(render);
   disposeSmsCooldown = () => cooldown.dispose();
   cooldown.select(form.elements.phone.value);
   form.elements.phone.addEventListener('input', () => {
    waiting = false; status.textContent = ''; $('#page-error').textContent = '';
    cooldown.select(form.elements.phone.value);
   });
   bind('send-code', async () => {
    if (sending || remaining > 0) return;
    const phone = form.elements.phone.value.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) throw new Error('请填写正确的11位手机号');
    sending = true; waiting = false; b.disabled = true; b.textContent = '准备验证…';
    $('#page-error').textContent = ''; status.textContent = '正在准备安全验证，请稍候…';
    try {
     const humanProof = await window.WqtVerification.captchaProof();
     if (!form.isConnected) return;
     b.textContent = '正在发送…'; status.textContent = '正在发送验证码…';
     const data = await request('/api/auth/sms/send', {token:null, body:{phone,...humanProof}});
     cooldown.start(phone, data.resendAfterSeconds ?? 60);
     if (form.isConnected && form.elements.phone.value.trim() === phone)
      status.textContent = data.mockCode ? '本地测试验证码：' + data.mockCode + '（未发送短信）' : '验证码已发送，请查看手机短信';
    } catch (e) {
     retry = true;
     if (!form.isConnected) return;
     if (e.code === 'SMS_RESEND_COOLDOWN' && e.retryAfterSeconds > 0) {
      waiting = form.elements.phone.value.trim() === phone;
      cooldown.start(phone, e.retryAfterSeconds);
     } else { status.textContent = ''; throw e; }
    } finally {
     sending = false;
     if (form.isConnected) render(remaining);
    }
   });
  }
  $("#auth-form").onsubmit = (e) => {
    e.preventDefault();
    safe(async () => {
      const submit =
        e.target.querySelector("[type=submit]") ||
        e.target.querySelector(".primary");
      submit.disabled = true;
      const submitLabel=submit.textContent;submit.textContent=mode==='password'?'准备验证…':'正在登录…';
      try {
        const credentials=Object.fromEntries(new FormData(e.target));
        const proof=mode==='password'?await window.WqtVerification.captchaProof():{};
        if(!e.target.isConnected)return;
        submit.textContent="正在登录…";
        const data = await request("/api/auth/login", {
          token: null,
          body: {
            ...credentials,
            verificationMethod: mode,
            ...proof,
          },
        });
        user = data.user;
        accounts = data.accounts;
        localStorage.setItem("WQT_AUTH_TOKEN", data.token);
        await restoreAudioDraft();
        await loadSettings();
        await chooseAccount();
      } finally {
        submit.disabled = false;submit.textContent=submitLabel;
      }
    });
  };
}
function accountChoices(){return `<div class="account-choice-list">${accounts.map((a,i)=>`<button class="account-choice ${a.id===account?.id?'is-current':''}" data-account="${a.id}"><span class="account-choice-icon">${String(i+1).padStart(2,'0')}</span><span><strong>${esc(a.name)} ${a.id===account?.id?'<span class="current-account-badge">当前账号</span>':''}</strong><small>${esc(a.organization_name)} · ${esc({watcher:'守望者',boss:'平台管理',operator:'平台运营',enterprise:'组织管理'}[a.role]||'组织成员')}</small><em>${a.valid_until?'权益期限至 '+new Date(Number(a.valid_until)).toLocaleDateString():'免费账号'}</em></span><span class="account-choice-arrow">${a.id===account?.id?'✓':'↗'}</span></button>`).join('')}</div>`}
async function selectPlayerAccount(id,{modal=false,activityCode=""}={}) {
 const data=await request('/api/auth/select-account',{body:{accountId:id}});
 generation++;aiController?.abort();user=data.user;account=accounts.find(a=>a.id===user.accountId);
 localStorage.setItem('WQT_AUTH_TOKEN',data.token);localStorage.setItem('WQT_USER_CACHE',JSON.stringify(user));
 await restoreAudioDraft();
 sessionStorage.removeItem('WQT_SESSION_ID');sessionStorage.removeItem('WQT_GAME_AUTH_TOKEN');
 state=null;session=null;card=null;events=[];lastFeedback=null;scoreOverview=null;autoEnding=false;practice=false;
 loginActivityCode=activityCode;
 if(modal)closeDialog();await refreshPending();await restore(!modal);if(modal)await me();
}
async function chooseAccount({modal=false,manual=false}={}){
 accounts=(await request('/api/auth/accounts')).accounts;
 const blocked=busy||audioSaving||recorder?.state==='recording'||(user&&account&&sessionStorage.getItem(operationKey()));
 const paidWatchers=accounts.filter(a=>['watcher','enterprise','boss'].includes(a.role)&&a.status==='active'&&Number(a.valid_until)>Date.now());
 if(!modal&&!manual&&!blocked){
  if(accounts.length===1 && ['watcher','enterprise','boss'].includes(accounts[0].role)){await selectPlayerAccount(accounts[0].id);return}
  if(paidWatchers.length===1){await selectPlayerAccount(paidWatchers[0].id);return}
  if(paidWatchers.length>1){
   show('accounts',surface('选择当前活动',`<p class="flow-lead">输入活动码，自动使用该活动所属组织的账号。</p><form id="activity-account-form" class="flow-form"><label>活动码<input name="code" required autocomplete="off" placeholder="请输入现场活动码"></label><button class="button primary">查找活动并进入</button></form><p id="page-error" role="alert"></p>${button('手动选择账号','manual-account')}`));
   bind('manual-account',()=>chooseAccount({manual:true}));
   $('#activity-account-form').onsubmit=e=>{
    e.preventDefault();safe(async()=>{
     const submit=e.target.querySelector('button');submit.disabled=true;
     try{
      const code=e.target.elements.code.value.trim();
      const data=await request('/api/auth/activity-account/'+encodeURIComponent(code));
      if(data.accounts.length!==1)throw new Error(data.accounts.length?'该组织存在多个可用账号，请联系管理员核查绑定。':'你没有绑定此活动所属组织的可用账号，请联系组织管理员。');
      const matched=data.accounts[0];if(!accounts.some(a=>a.id===matched.id))accounts.push(matched);
      await selectPlayerAccount(matched.id,{activityCode:data.activity.activity_code||code});
     }finally{submit.disabled=false}
    });
   };return;
  }
 }
 const caption=blocked?'请先完成未确认操作，或停止并保存录音，再切换账号。':state&&!state.ended?'当前游戏会保留在原账号下；切换不会结束本局或停止倒计时。':'选择这次使用的组织账号。';
 if(modal){dialog('切换账号',`<p class="switch-caption">${esc(caption)}</p>${accountChoices()}`);activeDialog.classList.add('account-switcher')}
 else show('accounts',surface('选择当前账号',`<p class="flow-lead">${esc(caption)}</p>${accountChoices()}${accounts.length?'':note('暂无可用账号，请联系平台管理员。')}<p id="page-error" role="alert"></p>`));
 const host=modal?activeDialog:root;
 const add=document.createElement('button');add.type='button';add.className='account-add';add.innerHTML='<span aria-hidden="true">＋</span><span>增加组织或账号<small>使用邀请码，绑定到当前登录身份</small></span>';
 host.querySelector('.account-choice-list').append(add);add.disabled=!!blocked;add.onclick=()=>safe(()=>addAccount({modal}));
 host.querySelectorAll('[data-account]').forEach(button=>{
  button.disabled=!!blocked&&Number(button.dataset.account)!==account?.id;
  button.onclick=()=>safe(async()=>{
   const id=Number(button.dataset.account);if(modal&&id===account?.id){closeDialog();return}
   if(blocked)throw new Error(caption);
   host.querySelectorAll('[data-account]').forEach(b=>b.disabled=true);
   try{await selectPlayerAccount(id,{modal})}
   catch(e){host.querySelectorAll('[data-account]').forEach(b=>b.disabled=false);throw e}
  });
 });
}
function addAccount({modal=false}={}){
 dialog('增加组织或账号',`<p>填写平台或组织提供的邀请码。新增账号会绑定到当前登录身份，添加后可在列表中选择。</p><form id="account-invite-form" class="flow-form"><label>邀请码<input name="inviteCode" required maxlength="120" autocomplete="off" placeholder="请输入邀请码"></label><label>当前登录密码<input name="password" type="password" required autocomplete="current-password" placeholder="验证是你本人操作"></label><div class="invite-actions"><button type="button" class="button" id="invite-back">返回账号列表</button><button type="submit" class="button primary">验证并添加</button></div></form>`);
 activeDialog.classList.add('account-invitation');const form=activeDialog.querySelector('form');let attempt=null;
 activeDialog.querySelector('#invite-back').onclick=()=>safe(()=>chooseAccount({modal}));
 form.onsubmit=e=>{e.preventDefault();safe(async()=>{
  const code=form.elements.inviteCode.value.trim().toUpperCase();
  if(!code)throw new Error('请填写邀请码');
  if(!attempt||attempt.code!==code)attempt={code,requestId:crypto.randomUUID()};
  const submit=form.querySelector('[type=submit]');submit.disabled=true;form.elements.inviteCode.readOnly=true;
  try{
   await request('/api/auth/join-with-invite',{body:{inviteCode:code,password:form.elements.password.value,verificationMethod:'password',requestId:attempt.requestId}});
   form.elements.password.value='';await chooseAccount({modal});
   const host=modal?activeDialog:root;const success=document.createElement('p');success.className='account-added';success.setAttribute('role','status');success.textContent='账号已增加，请选择要使用的账号。';host.querySelector('.account-choice-list').before(success);
  }catch(error){if(error.status&&error.status<500){attempt=null;form.elements.inviteCode.readOnly=false}throw error}
  finally{submit.disabled=false}
 });};
}
async function resumeLogin(){
 let inherited=false;
 if(!localStorage.getItem('WQT_AUTH_TOKEN')){
  for(const token of [localStorage.getItem('aw_token'),localStorage.getItem('ep_token')].filter(Boolean)){
   try{const existing=await request('/api/auth/session',{token});if(existing.user?.identityId){localStorage.setItem('WQT_AUTH_TOKEN',token);inherited=true;break}}catch{/* A stale app token must not clear another app's credentials. */}
  }
 }
 if(!localStorage.getItem('WQT_AUTH_TOKEN')){entry();return}
 show('entry',surface('正在恢复登录',loadingPanel()));
 try{
  const data=await request('/api/auth/session');loginSession=data.session;user=data.user;accounts=data.accounts;account=accounts.find(a=>a.id===user.accountId)||null;
  await restoreAudioDraft();
  localStorage.setItem('WQT_USER_CACHE',JSON.stringify(user));await loadSettings();
  if(data.requiresAccountSelection||inherited){await chooseAccount();return}
  await refreshPending();await restore();
 }catch(e){
  if(e.status===401||e.status===403){localStorage.removeItem('WQT_AUTH_TOKEN');localStorage.removeItem('WQT_USER_CACHE');user=null;account=null;state=null;session=null;login();$('#page-error').textContent=e.message;return}
  show('entry',surface('登录恢复暂时不可用',emptyPanel('请稍后重试',e.message)+button('重新恢复登录','resume-login',true)));bind('resume-login',resumeLogin);
 }
}
async function refreshPending() {
  pending = (await request("/api/player/feedback")).pending;
  syncIdentity();
}
async function restore(render=true) {
  const last = (await request("/api/game/last-session")).session;
  if (last?.player_state_json) {
    const data = await request("/api/player/session/" + last.id);
    session = data.session;
    state = data.state;
    events = data.events;
    scoreOverview=data.scoreOverview;
    await loadCards(session.card_group_id);
    if(render)game();
  } else {state=null;session=null;card=null;if(render)activities()}
}
async function loadCards(groupId) {
  cards=(await request(session?.id ? '/api/player/cards/'+session.id : '/api/cards'+(groupId?'?group_id='+groupId:''))).cards;
}
function activities(result = null) {
  if (state && !state.ended) {
    game();
    return;
  }
  show(
    "activities",
    surface(
      "选择当前活动",
      `<p class="flow-lead">输入活动码，查找后选择现场活动。</p><form id="code-form" class="picker-toolbar"><label>活动码<input name="code" value="${esc(loginActivityCode)}" required placeholder="请输入现场活动码"></label><button class="button primary">查找</button></form><p id="page-error" role="alert"></p>${result ? `<div class="activity-grid"><button class="activity-card" id="select-activity"><span class="tag">可开始</span><h2>${esc(result.name)}</h2><p>${esc(result.organizer)}</p><strong>${esc(result.activity_code)}</strong><span>点击选择 →</span></button></div>` : '<div class="activity-search-empty"><span>⌕</span><h2>用活动码找到现场活动</h2></div>'}`,
    ),
  );
  $("#code-form").onsubmit = (e) => {
    e.preventDefault();
    safe(async () => {
      const code = e.target.elements.code.value.trim();
      const data = await request(
        "/api/activities/by-code/" + encodeURIComponent(code),
      );
      activities(data.activity);
    });
  };
  bind("select-activity", () => {
    activity = result;
    configure();
  });
}
function configure() {
  const modes = JSON.parse(settings.GAME_MODES || "[]"),
    mode = modes[0] || {
      distribution: {},
      time: Number(settings.DEFAULT_GAME_TIME) || 5000,
    };
  show(
    "configure",
    surface(
      "查看活动配置",
      `<div class="config-heading"><h2>${esc(activity.name)}</h2><span class="tag">${esc(activity.activity_code)}</span></div><form id="config-form"><div class="form-grid">${formField("location", "活动地点", activity.location || activity.organizer, "required")}${formField("players", "参与者（可选，以逗号分隔）", "", 'maxlength="400"')}${formField("duration", "倒计时（秒）", mode.time, 'type="number" min="1" max="10800" required')}<label>游戏模式<select name="mode">${modes.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("")}</select></label><label>卡牌组<select name="group">${groups.map((g) => `<option value="${g.id}" ${g.is_default ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select></label>${phases.map((n, i) => formField("count" + i, n + "卡牌数", mode.distribution?.[n] ?? 3, 'type="number" min="0" max="15" required')).join("")}</div>${note("数量为0的阶段自动跳过；卡牌进入游戏后选择。")}<p id="page-error" role="alert"></p><div class="toolbar">${button("上一步", "back-activities")}<button class="button primary">开启新游戏　↗</button></div></form>`,
    ),
  );
  bind("back-activities", () => activities(activity));
  $('#config-form').elements.mode.onchange=e=>{const selected=modes.find(m=>m.id===e.target.value);if(selected){$('#config-form').elements.duration.value=selected.time;phases.forEach((n,i)=>$('#config-form').elements['count'+i].value=selected.distribution?.[n]??3)}};
  $("#config-form").onsubmit = (e) => {
    e.preventDefault();
    safe(async () => {
      await refreshPending();
      if (
        pending.length &&
        !window.confirm("上一场反馈尚未完成。确定暂时跳过并开始下一场？")
      ) {
        await me("feedback");
        return;
      }
      const f = new FormData(e.target),
        data = await write("/api/player/start", {
          activityCode: activity.activity_code,
          location: f.get("location"),
          players: String(f.get("players") || "")
            .split(/[,，]/)
            .map((n) => n.trim())
            .filter(Boolean),
          cardGroupId: Number(f.get("group")) || null,
          mode: f.get("mode") || "standard",
          settings: {
            duration: Number(f.get("duration")),
            counts: [0, 1, 2].map((i) => Number(f.get("count" + i))),
          },
        });
      session = { id: data.sessionId };
      const saved = await request("/api/player/session/" + session.id);
      autoEnding=false;
      session = saved.session;
      state = saved.state;
      events = saved.events;
      card = null;
      await loadCards(session.card_group_id);
      game();
    });
  };
}
function operationKey() {
  return `WQT_PLAYER_PENDING:${user.identityId}:${account.id}`;
}
async function write(path, body) {
  if (busy) throw new Error("正在保存，请稍候");
  busy = true;
  let op;
  const key = operationKey();
  try {
    op = JSON.parse(sessionStorage.getItem(key) || "null");
    if (op) {
      if (op.path !== path || JSON.stringify(op.body) !== JSON.stringify(body))
        throw new Error("上一操作结果尚未确认，请先重试该操作或刷新恢复");
    } else {
      op = { path, body, requestId: crypto.randomUUID() };
      sessionStorage.setItem(key, JSON.stringify(op));
    }
    const result = await request(path, {
      body: { ...op.body, requestId: op.requestId },
    });
    sessionStorage.removeItem(key);
    return result;
  } catch (e) {
    if (e.status >= 400 && e.status < 500 && ![408, 429].includes(e.status))
      sessionStorage.removeItem(key);
    throw e;
  } finally {
    busy = false;
  }
}
async function action(action, extra = {}) {
  const data = await write("/api/player/action", {
    sessionId: session.id,
    revision: state.revision,
    action,
    ...extra,
  });
  const latest = await request('/api/player/session/'+session.id);
  state = latest.state;
  session = latest.session;
  events = latest.events;
  scoreOverview=latest.scoreOverview;
  if (state.ended) {
    if (recorder?.state === "recording") await stopRecording();
    session.ended_at = state.endedAt;
    session.final_score = data.finalScore ?? session.final_score;
    await refreshPending();
  }
  return data;
}
function clock() {
  if(practice)return "自由体验";
  if (!state) return "";
  return (
    Math.max(
      0,
      state.duration -
        Math.floor(
          ((state.paused ? state.pauseAt : Date.now()) -
            state.startedAt -
            state.pausedMs) /
            1000,
        ),
    ) + " 秒"
  );
}
function gameMarkup(body,stage=''){
 return `<div class="shell"><aside class="rail"><div class="glass rail-card"><div class="rail-title">倒计时</div><div class="time" id="clock">${clock()}</div><p>${phases[state.phase]} · ${state.done[state.phase]} / ${state.counts[state.phase]}</p></div><div class="glass rail-card"><h3><span class="skill-heading-text">伍力技能</span><button id="skill-fold" class="skill-fold" aria-expanded="false" aria-controls="skill-list">伍力技能<span>展开</span></button></h3><div id="skill-list">${names.map(n=>`<button class="compact-skill ${state.used.includes(n)?'is-used':''}" data-skill="${n}"><span>${n}</span><small>${state.used.includes(n)?'已使用 · 查看':'可使用'}</small></button>`).join('')}</div></div><div class="rail-bottom">${button(state.paused?'恢复游戏':'暂停游戏','pause')}${button('结束游戏并复盘','finish')}</div></aside><main class="work"><p id="page-error" role="alert"></p><div class="pause-status ${state.paused?'visible':''}" role="status"><span>Ⅱ</span> 本局暂停中</div><article class="reader"><div class="reader-inner">${body}</div></article>${stage}</main></div>`;
}
function game() {
 if(state.ended&&!practice){ended();return}
 const confirmed=lastFeedback?.cardId===card?.id;
 const body=card?`<div class="cardbar"><b class="card-number">${esc(card.card_code)}</b><span>情景卡</span>${button('重新选卡','pick')}</div><div class="cardbody"><div class="heading"><div><h2>${esc(card.title)}</h2></div><div class="risk">${esc(card.safetyType)}</div><div class="listen-control">${button('▷ 聆听题面','listen')}${window.getCardImage?.(card.card_code)?button('查看卡面','card-face'):''}</div></div><p class="story">${esc(card.event)}</p><div class="decision-label">如果是你，你会怎么做？</div><div class="choices ${state.d[card.id]?'has-d':''}">${Object.entries({...card.options,...(state.d[card.id]?{D:{text:state.d[card.id]}}:{})}).map(([choice,o])=>`<button class="choice ${choice===selected?'selected':''}" data-choice="${choice}" aria-pressed="${choice===selected}" ${state.paused||confirmed?'disabled':''}><b>${choice}</b><span>${esc(o.text)}</span></button>`).join('')}</div><div class="actions"><div class="status" role="status">${confirmed?'已确认 '+selected:selected?'已选择 '+selected+' · 尚未确认':'请选择'}</div><button class="confirm" id="confirm">${confirmed?'查看反馈':'确认选择'}　↗</button></div></div>`:`<div class="idle-card"><button class="select-card" id="pick"><span class="idle-card-symbol" aria-hidden="true"><i></i><i></i><i></i></span><strong>点击选卡</strong><span>选择现场正在进行的卡牌</span><b>＋</b></button></div>`;
 show('game',gameMarkup(body,state.pending&&!practice?`<section class="surface phase-result"><h2>${state.pending==='failure'?'本阶段需要重新出发':'本阶段完成'}</h2>${button((state.pending==='failure'&&state.failures>=3)||(!state.counts.slice(state.phase+1).some(v=>v>0)&&state.pending==='phase')?'完成本局并结算':'继续下一步','advance',true)}</section>`:''));
  bind("pick", pick);
  bind("pause", async () => {
    if(practice)throw new Error("自由体验不修改场次状态");
    await action("pause");
    game();
  });
  bind("finish", async () => {
    if(practice){ended();return}
    if (window.confirm("确认提前结束并冻结本局记录？")) {
      await action("finish");
      ended();
    }
  });
  bind("advance", async () => {
    const end =
      (state.pending === "failure" && state.failures >= 3) ||
      (state.pending === "phase" &&
        !state.counts.slice(state.phase + 1).some((v) => v > 0));
    await action(end ? "finish" : "advance");
    card = null;
    selected = null;
    lastFeedback=null;
    game();
  });
  if (card) {
    root.querySelectorAll("[data-choice]").forEach(
      (b) =>
        (b.onclick = () => {
          selected = b.dataset.choice;
          game();
        }),
    );
    $("#confirm").disabled = !selected || state.paused;
    bind("confirm", async () => {
      const choice = selected;
      if(lastFeedback?.cardId===card.id){feedback(lastFeedback.payload,lastFeedback.choice);return}
      if(practice){const payload={consequence:card.options[choice]?.consequence||"这是已保存的创新方案，自由体验不重新调用AI。",reason:"自由体验 · 不计分"};feedback(payload,choice);return}
      const data = await action("choice", { cardId: card.id, choice });
      feedback(data.payload, choice);
    });
    bind("listen", () => listen(card.title + "。" + card.event,card.audio_url));
    bind('card-face',()=>{const url=window.getCardImage(card.card_code);dialog('卡牌卡面',`<img style="width:100%;height:auto" src="${esc(url.startsWith('/')?url:'/'+url)}" alt="${esc(card.title)}">`)});
  }
  root
    .querySelectorAll("[data-skill]")
    .forEach((b) => (b.onclick = () => safe(() => skill(b.dataset.skill))));
}
function pick() {
  dialog(
    "选择当前卡牌",
    `<div class="picker-toolbar"><label>卡牌编号或标题<input id="card-search" aria-label="卡号或标题" placeholder="输入卡号或标题"></label></div><div class="picker-filters"><label>风险分类<select id="card-risk"><option value="">全部风险</option>${[...new Set(cards.map(c=>c.safetyType))].map(n=>`<option>${esc(n)}</option>`).join('')}</select></label><button id="reset-card-filters" class="button">重置筛选</button></div><p class="picker-count" id="picker-count" role="status"></p><div id="card-list" class="card-grid"></div>`,
  );
  activeDialog.classList.add("flow-card-picker");
  const render = () => {
    const risk=$("#card-risk").value;
    const q = $("#card-search").value.trim().toLowerCase();
    $("#card-list").innerHTML =
      cards
        .filter(
          (c) =>
            (practice || c.phase === phases[state.phase]) && (!risk||c.safetyType===risk) &&
            (!q || (c.card_code + " " + c.title).toLowerCase().includes(q)),
        )
        .map(
          (c) =>
            `<button class="card-tile" data-card="${c.id}"><small>${esc(c.card_code)} · ${esc(c.safetyType)}</small><h2>${esc(c.title)}</h2></button>`,
        )
        .join("") || note("没有符合条件的未选卡牌");
    $("#picker-count").textContent="找到 "+$("#card-list").querySelectorAll("[data-card]").length+" 张卡牌";
    $("#card-list")
      .querySelectorAll("[data-card]")
      .forEach(
        (b) =>
          (b.onclick = () => {
            card = cards.find((c) => c.id === Number(b.dataset.card));
            selected = null;
            lastFeedback=null;
            closeDialog();
            game();
          }),
      );
  };
  $("#card-risk").onchange=render;
  bind("reset-card-filters",()=>{$("#card-search").value="";$("#card-risk").value="";render()});
  $("#card-search").oninput = render;
  render();
}
let activeDialog = null,feedbackTimer=null;
function closeDialog() {
  clearInterval(feedbackTimer);feedbackTimer=null;
  activeDialog?.close();
  activeDialog?.remove();
  activeDialog = null;
}
function dialog(title, body) {
  closeDialog();
  activeDialog = document.createElement("dialog");
  activeDialog.className = "game-drawer";
  activeDialog.innerHTML = `<div class="drawer-head"><h2>${title}</h2><button id="dialog-close" class="drawer-close" aria-label="关闭面板">×</button></div>${body}<p id="dialog-error" role="alert"></p>`;
  document.body.append(activeDialog);
  $("#dialog-close").onclick = closeDialog;
  activeDialog.showModal();
  activeDialog.addEventListener("close",()=>{clearInterval(feedbackTimer);feedbackTimer=null});
}
function skillFeedback(name,body){
 dialog(name,body+`<div class="feedback-window-foot"><span id="auto-close-note"></span><button id="keep-feedback" class="drawer-action secondary">保持打开</button></div>`);
 activeDialog.classList.add('skill-feedback-window');
 $('#dialog-close').innerHTML='<svg viewBox="0 0 40 40" aria-hidden="true"><circle class="countdown-track" cx="20" cy="20" r="17"/><circle class="countdown-progress" cx="20" cy="20" r="17" pathLength="100"/></svg><span>×</span>';
 const duration=['创心力','沟通力'].includes(name)?60000:8000,end=Date.now()+duration;
 const update=()=>{const remaining=Math.max(0,end-Date.now());if(!$('#auto-close-note'))return;$('#auto-close-note').textContent=Math.ceil(remaining/1000)+' 秒后收起';$('#dialog-close .countdown-progress').style.strokeDashoffset=String(100-remaining/duration*100);if(!remaining)closeDialog()};
 update();feedbackTimer=setInterval(update,100);
 bind('keep-feedback',()=>{clearInterval(feedbackTimer);feedbackTimer=null;$('#auto-close-note').textContent='已保持打开';$('#keep-feedback').disabled=true;$('#dialog-close .countdown-progress').style.strokeDashoffset='0'});
}
function skillBody(name,event){
 if(name==='安全力'){
 const before=event?.attributesBefore||{},after=event?.attributesAfter||Object.fromEntries(names.map((n,i)=>[n,state.values[i]]));
 const increased=names.filter(n=>before[n]!==undefined&&before[n]!==after[n]);
 return `<p class="skill-kicker">伍力反馈</p><div class="skill-score-grid">${names.map(n=>`<div class="skill-score ${increased.includes(n)?'increased':''}"><span>${n}</span><strong>${after[n]}</strong><small>${increased.includes(n)?before[n]+' → '+after[n]+' · +1':'未变化'}</small></div>`).join('')}</div><p class="skill-guidance">${increased.length?'这次安全守护提升了'+increased.join('、')+'，让我们带着这份支持继续探索。':'当前没有值为 1 的能力，本次不调整得分。'}</p>`;
 }
 if(name==='创心力')return `<p class="skill-kicker">${esc(cards.find(c=>c.id===state.skillCards?.[name])?.card_code||'')} · 选项 D 已加入</p><p class="skill-guidance">${esc(event?.optionD||state.d[state.skillCards?.[name]]||'')}</p><p class="drawer-note">回到卡牌后，可在 A、B、C、D 中选择，再确认提交。</p>`;
 const copy=name==='脑波力'?['把注意力带回当下','请大家暂时移开视线，望向远处 30 秒，再把注意力带回眼前的伙伴。']:['起身，感受身体','邀请大家在安全、宽敞的位置做 5 个开合跳；不方便活动的同学可以原地舒展或跳过。'];
 return `<p class="skill-kicker">伍力练习</p><h3 class="skill-prompt">${copy[0]}</h3><article class="skill-analysis-piece"><span>01</span><p>${copy[1]}</p></article><p class="drawer-note">收起倒计时不是练习计时；需要边看边做可选择“保持打开”。</p>`;
}
async function skill(name){
 if(state.paused)throw new Error('本局暂停中');
 if(state.used.includes(name)){
 if(name==='沟通力'){await generateAi('communication',true);return}
 const saved=events.filter(e=>e.type==='skill_use').map(e=>{try{return JSON.parse(e.payload)}catch{return {}}}).find(e=>e.skill===name);
 skillFeedback(name,skillBody(name,saved));return;
 }
 if(['创心力','沟通力'].includes(name)&&!card){dialog(name+' · 需要当前卡牌','<div class="skill-empty"><span>◇</span><h3>先选择一张情景卡</h3><p>技能会结合当前卡牌帮助大家思考。选卡后，再点击'+name+'。</p></div>');activeDialog.classList.add('skill-feedback-window');return}
 if(name==='创心力'){
 if(lastFeedback?.cardId===card.id)throw new Error('请在下一张卡确认前提出创新方案');
 dialog('创心力 · 增加选项 D',`<label for="creative-text">为 ${esc(card.card_code)} 写下你的解决方案</label><p class="creative-intro">不止 A、B、C。一起提出第四种可能，让小伍找到新的行动路径。</p><form id="creative-form"><textarea name="text" id="creative-text" required maxlength="240" placeholder="你还会怎么做？"></textarea><div class="creative-actions"><button class="drawer-action primary">加入情景卡</button><button type="button" class="drawer-action secondary" id="cancel-d">取消</button></div></form><p class="drawer-note">不自动收起；取消不消耗技能。</p>`);
 activeDialog.classList.add('skill-feedback-window');bind('cancel-d',closeDialog);
 $('#creative-form').onsubmit=e=>{e.preventDefault();safe(async()=>{const submit=e.target.querySelector('[type=submit]')||e.target.querySelector('.primary');submit.disabled=true;try{const result=await action('skill',{skill:name,cardId:card.id,text:e.target.elements.text.value});game();skillFeedback(name,skillBody(name,result.payload))}catch(error){submit.disabled=false;throw error}})};return;
 }
 const result=await action('skill',{skill:name,cardId:card?.id});game();
 if(name==='沟通力')await generateAi('communication',true);else skillFeedback(name,skillBody(name,result.payload));
}
async function generateAi(purpose, inDialog = false) {
  if (!card && !(purpose === "communication" && state.skillCards?.["沟通力"])) throw new Error("请先选择卡牌");
  const current = generation,
    target = inDialog ? "#ai-dialog" : "#ai-feedback";
  if (inDialog)
    skillFeedback("沟通力",'<p class="skill-kicker">当前情景 · 分析参考</p><div id="ai-dialog" aria-live="polite"></div>');
  const el = $(target);
  if (!el) return;
  el.textContent = "正在整理这次选择的反馈…";
  aiController = new AbortController();
  try {
    const data = await request("/api/player/ai-feedback", {
      body: { sessionId: session.id, cardId: purpose==="communication"?state.skillCards["沟通力"]:card.id, purpose },
      signal: aiController.signal,
    });
    if (current !== generation) return;
    el.innerHTML = data.feedback.split(/\n\s*\n/).filter(Boolean).map((paragraph,i)=>`<article class="skill-analysis-piece">${inDialog?`<span>${String(i+1).padStart(2,"0")}</span>`:""}<p>${esc(paragraph)}</p></article>`).join("");
  } catch (e) {
    if (current !== generation) return;
    el.innerHTML = `<p>${esc(e.message)}</p><button id="retry-ai" class="button">重试反馈</button>`;
    bind("retry-ai", () => generateAi(purpose, inDialog));
  }
}
function feedback(payload,choice){
 lastFeedback={cardId:card.id,payload,choice};
 show('game',gameMarkup(`<section class="feedback"><div><div class="eyebrow">选择反馈</div><h2 id="feedback-title">这一次选择，带来了什么？</h2><div class="feedback-choice">${esc(card.card_code)} · 已选 ${choice}</div><div id="ai-feedback" aria-live="polite">${choice==='D'?'':`<p id="feedback-text">${esc(payload.consequence)}</p>`}</div>${choice==='D'?note('D选项不计分。'):''}</div><div class="flow-feedback-actions">${button('返回卡牌','back-card')}${button('继续　↗','next',true)}</div></section>`));
 bind('back-card',game);
 bind('next',()=>{card=null;selected=null;lastFeedback=null;game()});
 bind('pause',async()=>{await action('pause');feedback(payload,choice)});
 bind('finish',async()=>{if(window.confirm('确认提前结束并冻结本局记录？')){await action('finish');ended()}});
 root.querySelectorAll('[data-skill]').forEach(b=>b.onclick=()=>safe(()=>skill(b.dataset.skill)));
 if(choice==='D'&&!practice)generateAi('creative');
 if(choice==='D'&&practice)$('#ai-feedback').textContent=payload.consequence;
}
async function stopRecording() {
  return new Promise((resolve) => {
    if (!recorder || recorder.state !== "recording") {
      resolve();
      return;
    }
    const current = recorder.onstop;
    recorder.onstop = async (e) => {
      await current?.(e);
      resolve();
    };
    recorder.stop();
  });
}
function recordPanel() {
  if (audioContext && audioContext.identityId !== user?.identityId) throw new Error("请使用录音原身份登录");
  if (!session && !audioBlob) throw new Error("请先开局");
  dialog(
    "现场录音",
    `<p>开始前请告知参与者并取得所需同意。录音不会自动开启。</p>${audioBlob ? `<p>场次 ${esc(audioContext.sessionId)} 的录音待保存；可以继续开新局，保存后可开启新的录音。</p>` : button(recorder?.state === "recording" ? "停止录音" : "开始录音", "record-toggle", true)}${audioBlob ? `<div class="toolbar">${button("上传并保存", "upload-audio")}${button("下载本地副本", "local-audio")}${button("已保存本地，清除暂存", "clear-audio")}</div>` : ""}<p id="audio-status" role="status">${esc(audioDraftWarning)}</p>`,
  );
  bind("record-toggle", async () => {
    if (recorder?.state === "recording") {
      await stopRecording();
      recordPanel();
      return;
    }
    await restoreAudioDraft();
    if (audioBlob) throw new Error("请先保存待处理录音，避免覆盖原场次录音");
    if (!session || !state || state.ended) throw new Error("请先开启新局，再开始录音");
    if (!window.confirm("确认已取得参与者同意，开始录音？")) return;
    audioContext = {
      sessionId: session.id,
      identityId: user.identityId,
      accountId: account.id,
      draftId: crypto.randomUUID(),
    };
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = async () => {
      audioBlob = new Blob(chunks, { type: recorder.mimeType });
      stream.getTracks().forEach((t) => t.stop());
      await persistAudioDraft();
      syncIdentity();
    };
    recorder.start();
    syncIdentity();
    recordPanel();
  });
  bind("local-audio", () => {
    downloadBlob(audioBlob, `游戏录音-场次${audioContext.sessionId}.webm`);
    $("#audio-status").textContent = "已发起下载；确认本地副本可用后，可清除暂存。";
  });
  bind("clear-audio", async () => {
    if (audioSaving) return;
    if (!window.confirm("确认已保存可用的本地副本？清除后无法从本页恢复这份录音。")) return;
    await clearAudioDraft();
    syncIdentity();
    recordPanel();
  });
  bind("upload-audio", async () => {
    if (audioSaving || !audioBlob) return;
    const context = audioContext, blob = audioBlob, persisted = audioDraftPersisted;
    audioSaving = true;
    const data = new FormData();
    data.append("sessionId", String(context.sessionId));
    data.append("file", blob, "游戏录音.webm");
    const status = $("#audio-status");
    status.textContent = "正在上传，请勿离开…";
    try {
      // Recheck live authentication; a recovered draft must never reuse an old JWT.
      const token = localStorage.getItem("WQT_AUTH_TOKEN");
      const current = await request("/api/auth/session", { token });
      if (current.user?.identityId !== context.identityId || current.user?.accountId !== context.accountId)
        throw new Error("请使用录音原身份及原账号上传，或下载本地副本");
      const response = await fetch("/api/upload/audio", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: data,
      });
      if (!response.ok)
        throw new Error((await response.json()).error || "上传失败");
      await clearAudioDraft(context, persisted);
      status.textContent = "录音已保存，可在报告与录音中查看";
      syncIdentity();
    } catch (e) {
      status.textContent =
        e.message + "；录音仍保留，可重试或下载本地副本";
    } finally {
      audioSaving = false;
    }
  });
}

function listen(text,audioUrl) {
  if(audioUrl){const url=new URL(audioUrl,location.origin);if(url.origin===location.origin||url.hostname==='ai5000days-scoring-system-hk.oss-cn-hongkong.aliyuncs.com'){narration?.pause();narration=new Audio(url.href);narration.onerror=()=>alertError(new Error('卡牌语音暂不可播放'));narration.play().catch(alertError);return}}
  if (!window.speechSynthesis) throw new Error("设备不支持朗读");
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  speechSynthesis.speak(utterance);
}
function watch() {
  if (!state) {
    show(
      "watch",
      surface("尚未开始游戏", button("开启新游戏", "watch-start", true)),
    );
    bind("watch-start", activities);
    return;
  }
  const attrs = state.values;
  show(
    "watch",
    `<div class="watch-grid"><section class="surface watch-status" tabindex="0" aria-label="伍力状态与分数调整"><h2>伍力状态</h2><div class="watch-score-tiles">${names.map((n, i) => `<div class="watch-score-tile"><small>${n}</small><strong>${attrs[i]}</strong><div class="watch-score-meter"><i style="width:${attrs[i] * 10}%"></i></div></div>`).join("")}</div><div id="watch-radar">${radarMarkup(attrs)}</div><details class="score-controls"><summary>调整伍力得分</summary><form id="adjust-form" class="score-adjust-form"><div class="score-step-list">${names.map((n, i) => `<div class="score-step-row"><label for="score-value-${i}">${n}</label><div class="score-stepper"><button type="button" data-score-step="${i}" data-delta="-1" aria-label="${n}减1" ${state.ended||attrs[i]<=0?"disabled":""}>−</button><input id="score-value-${i}" name="value${i}" aria-label="${n}得分" type="number" min="0" max="10" value="${attrs[i]}" readonly><button type="button" data-score-step="${i}" data-delta="1" aria-label="${n}加1" ${state.ended||attrs[i]>=10?"disabled":""}>＋</button></div></div>`).join("")}</div><div class="score-reason">${formField("reason", "调整理由（选填）", "", 'maxlength="200"')}<p class="section-caption">加减后可预览雷达变化，确认调整后保存。</p><button class="button primary" ${state.ended ? "disabled" : ""}>确认调整</button></div></form></details></section><section class="surface watch-board"><div class="board-heading"><h2>最近操作看板</h2><button id="board-font" class="font-size-control" aria-label="切换最近操作看板字体大小">Aa <span></span></button></div><div class="operation-timeline">${
      events
        .slice(-10)
        .reverse()
        .map((ev) => {
          let data = {};
          try {
            data = JSON.parse(ev.payload);
          } catch {}
          return `<article><i></i><div><small>${esc(({card_choice:'卡牌选择',skill_use:'伍力技能',game_start:'开始游戏',game_finish:'本局结算',pause:'暂停 / 恢复',adjust:'调整分数',advance:'阶段推进'})[ev.type]||'现场记录')} · ${new Date(Number(ev.ts)).toLocaleTimeString()}</small><strong>${esc(data.cardCode ? data.cardCode + " · " + data.choice : data.skill || data.text || "游戏状态更新")}</strong>${data.reason ? `<div class="reason-list">${esc(data.reason)}</div>` : ""}${data.attributeDelta ? `<div class="effect-chips">${names.map((n) => `<span class="effect-chip">${n} <b>${Number(data.attributeDelta[n] || 0) > 0 ? "+" : ""}${data.attributeDelta[n] || 0}</b></span>`).join("")}</div>` : ""}</div></article>`;
        })
        .join("") || note("尚无操作记录")
    }</div></section></div><p id="page-error" role="alert"></p>`,
  );
  const sizes=['normal','large','largest'],labels=['标准','大','特大'];
  let size=Number(localStorage.getItem('WQT_BOARD_FONT')||0);if(!Number.isInteger(size)||size<0||size>2)size=0;
  const setSize=()=>{$('.operation-timeline').dataset.font=sizes[size];$('#board-font span').textContent=labels[size];$('#board-font').setAttribute('aria-label','看板字体 '+labels[size]+'，点击切换');localStorage.setItem('WQT_BOARD_FONT',String(size))};setSize();bind('board-font',()=>{size=(size+1)%3;setSize()});
  root.querySelectorAll("[data-score-step]").forEach(control => {
    control.onclick = () => {
      if (state.ended || busy) return;
      const input = $("#score-value-" + control.dataset.scoreStep);
      input.value = String(Math.max(0, Math.min(10, Number(input.value) + Number(control.dataset.delta))));
      const values = names.map((_, i) => Number($("#score-value-" + i).value));
      $("#watch-radar").innerHTML = radarMarkup(values);
      root.querySelectorAll("[data-score-step]").forEach(b => {
        const value = values[Number(b.dataset.scoreStep)];
        b.disabled = Number(b.dataset.delta) < 0 ? value <= 0 : value >= 10;
      });
    };
  });
  $("#adjust-form").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    safe(async () => {
      await action("adjust", {
        values: names.map((_, i) => Number(f.get("value" + i))),
        reason: f.get("reason"),
      });
      watch();
    });
  };

}
function radarMarkup(attrs){
 const details=scoreOverview?.scoreDetails||{};
 const rates=names.map((n,i)=>{const max=Number(details[n]?.max||0);return max>0?Math.max(0,Math.min(1,attrs[i]/max))*10:0});
 const score=Math.round(rates.reduce((sum,value)=>sum+value,0)/names.length*10);
 return `<div class="radar-overview"><svg class="radar" viewBox="0 0 360 330" role="img" aria-label="理想分值与实际得分率雷达">${[2,4,6,8,10].map(v=>`<polygon class="web" points="${polygon(names.map(()=>v))}"/>`).join('')}<polygon class="theory" points="${polygon(names.map(()=>10))}"/><polygon class="actual" points="${polygon(rates)}"/>${names.map((n,i)=>{const a=-Math.PI/2+i*2*Math.PI/5;return `<text x="${180+Math.cos(a)*143}" y="${163+Math.sin(a)*143}" text-anchor="middle">${n}</text>`}).join('')}</svg><div class="radar-total" aria-live="polite"><span>伍力总分</span><strong>${score}<small>分</small></strong></div></div><div class="legend"><span><i class="dashed"></i>理想分值</span><span><i></i>实际得分</span></div>`;
}
function polygon(values) {
  return values
    .map((v, i) => {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      return (
        180 +
        (Math.cos(a) * 110 * v) / 10 +
        "," +
        (163 + (Math.sin(a) * 110 * v) / 10)
      );
    })
    .join(" ");
}
function ended() {
  practice=false;
  show(
    "game",
    surface(
      "本局已结算",
      `<div class="watch-score-tiles">${names.map((n, i) => `<div class="watch-score-tile"><small>${n}</small><strong>${state.values[i]}</strong></div>`).join("")}</div><div class="toolbar">${button("自由体验","practice")}${button("生成复盘报告", "review", true)}${button("开启另一局", "another")}${button("填写本场反馈", "survey")}${audioBlob ? button("保存本局录音", "saved-audio") : ""}</div><div id="review-target"></div><p id="page-error" role="alert"></p>`,
    ),
  );
  bind('practice',()=>{practice=true;card=null;selected=null;game()});
  bind("saved-audio", recordPanel);
  bind("another", () => {
    state = null;
    card = null;
    activities();
  });
  bind("survey", () => me("feedback"));
  bind("review", async () => {
    sessionStorage.setItem("WQT_SESSION_ID", String(session.id));
    sessionStorage.setItem(
      "WQT_GAME_AUTH_TOKEN",
      localStorage.getItem("WQT_AUTH_TOKEN"),
    );
    await window.GameReview.openReview($("#review-target"));
  });
}
async function showLoginSession(){
 const data=await request('/api/auth/session');loginSession=data.session;
 dialog('当前登录会话',`<dl class="drawer-facts"><div><dt>登录时间</dt><dd>${new Date(loginSession.createdAt).toLocaleString()}</dd></div><div><dt>有效期至</dt><dd>${new Date(loginSession.expiresAt).toLocaleString()}</dd></div><div><dt>当前账号</dt><dd>${esc(account.name)}</dd></div></dl><p class="drawer-note">刷新、返回和切换账号不会延长本次登录期限。这里显示当前会话，历史登录日志尚未提供。</p>`);
}
async function entitlements(){
 show('me',surface('权益与体验',loadingPanel()));
 const current=generation,data=await request('/api/me/entitlements');if(generation!==current)return;
 const trial=data.experience,labels={active:'体验中',pending_activation:'待激活',expired:'体验已结束',not_granted:'未开通体验'};
 root.innerHTML=surface('权益与体验',`<div class="entitlement-grid"><section class="surface"><span class="list-kicker">当前组织账号</span><h2>${esc(data.account.name)}</h2><span class="status-pill ${data.account.paidValid?'live':''}">${data.account.paidValid?'付费权益有效':data.account.validUntil?'付费权益已到期':'免费账号'}</span><p>${data.account.validUntil?'权益期限至 '+new Date(Number(data.account.validUntil)).toLocaleString():'当前账号尚未开通付费权益。'}</p></section><section class="surface"><span class="list-kicker">本人体验权益</span><h2>${labels[trial.status]}</h2><p>${trial.active?'有效期至 '+new Date(Number(trial.until)).toLocaleString():trial.pending?'平台已开通，激活后连续30天。':'体验须由平台管理端开通，用户激活后开始计时。'}</p>${trial.canActivate?button('激活30天体验','activate-trial',true):''}${trial.active?note('体验期间，凭有效活动码开启游戏。'):''}</section></div><h2 class="capability-heading">当前可以使用</h2><div class="capability-list">${[['凭活动码开启游戏',data.capabilities.startGame],['资料下载',data.capabilities.downloads],['AI选项反馈',data.capabilities.aiFeedback]].map(([name,enabled])=>`<div><span>${name}</span><strong class="${enabled?'available':''}">${enabled?'可使用':'需有效权益'}</strong></div>`).join('')}</div><p class="scope-note">学习网站权益由学习平台单独管理，不在这里推断课程授权。</p><div class="toolbar">${button('返回个人信息','back-profile')}</div><p id="page-error" role="alert"></p>`);
 bind('back-profile',()=>me());bind('activate-trial',async()=>{const b=$('#activate-trial');b.disabled=true;try{await write('/api/me/trial/activate',{});await entitlements()}catch(e){b.disabled=false;throw e}});
}
async function studyMaterials(){
 if(!user?.validityValid)throw new Error('卡牌预习资料仅限有效付费权益账号查看');
 const data=await request('/api/cards/study');dialog('卡牌预习资料',`<div class="material-grid">${data.cards.map(c=>`<button class="card-tile" data-material="${c.id}"><small>${esc(c.card_code)}</small><h3>${esc(c.title)}</h3></button>`).join('')}</div>`);activeDialog.classList.add('flow-card-picker');
 activeDialog.querySelectorAll('[data-material]').forEach(b=>b.onclick=()=>{const c=data.cards.find(c=>c.id===Number(b.dataset.material));dialog(c.title,`<p class="story">${esc(c.event)}</p>${Object.entries(c.options).map(([key,o])=>`<article class="skill-analysis-piece"><span>${key}</span><p>${esc(o.text)}<br>${esc(o.consequence)}</p></article>`).join('')}`);activeDialog.classList.add('skill-feedback-window')});
}
async function createdActivities(){
 const data=await request('/api/me/activities/created');dialog('我创建的活动',data.activities.length?`<div class="content-list">${data.activities.map(a=>`<article class="list-row"><div><h3>${esc(a.name)}</h3><p>活动码 ${esc(a.activity_code)}</p></div><button class="button" data-activity-detail="${esc(a.activity_code)}">查看活动成绩</button></article>`).join('')}</div>`:emptyPanel('还没有创建的活动','活动开放创建后，会在这里显示。'));
 activeDialog.querySelectorAll('[data-activity-detail]').forEach(b=>b.onclick=()=>safe(async()=>{const result=await request('/api/activities/by-code/'+encodeURIComponent(b.dataset.activityDetail)+'?withSessions=1');dialog('活动成绩',`<h3>${esc(result.activity.name)}</h3>${(result.sessions||[]).map(row=>`<p>${esc(row.location||'场次 '+row.id)} · ${row.final_score==null?'未结算':row.final_score+'分'}</p>`).join('')||note('暂无已结算场次。')}`)}));
}
async function legacySession(id){
 const data=await request('/api/game/session/'+id);dialog('活动记录',`<h3>${esc(data.session.location||'场次 '+id)}</h3><p>${new Date(Number(data.session.started_at)).toLocaleString()} · ${data.session.ended_at?'已结算':'进行中'}</p><p>结算分数：${data.session.final_score??'未结算'}</p><div class="operation-timeline">${data.events.map(e=>{let payload={};try{payload=JSON.parse(e.payload)}catch{}return `<article><div><small>${new Date(Number(e.ts)).toLocaleTimeString()}</small><strong>${esc(payload.cardCode||payload.skill||'场次记录')}</strong><p>${esc(payload.consequence||payload.reason||payload.text||'')}</p></div></article>`}).join('')}</div>`);activeDialog.classList.add('skill-feedback-window');
}
async function downloads() {
  show(
    "downloads",
    surface(
      "下载中心",
      `<p class="section-caption">获取最新发布的带领资料。</p><div id="download-list">${loadingPanel()}</div><p id="page-error" role="alert"></p>`,
    ),
  );
  const current = generation;
  const data = await request("/api/downloads");
  if (generation !== current) return;
  $('#download-list').innerHTML='<div class="content-list">'+(data.releases.map(r=>`<article class="list-row download-row"><span class="list-icon media-icon" aria-hidden="true">▤</span><div><span class="list-kicker">版本 ${esc(r.version)}</span><h2>${esc(r.title)}</h2><p>${esc(r.filename)} · ${formatSize(r.size)}</p></div><button class="button primary" data-release="${esc(r.id)}">下载资料　↓</button></article>`).join('')||emptyPanel('资料正在准备中','发布新资料后，会在这里第一时间更新。','▤'))+'</div>';
  root.querySelectorAll("[data-release]").forEach(
    (b) =>
      (b.onclick = () =>
        safe(async () => {
          b.disabled = true;
          try {
            const r = data.releases.find((r) => r.id === b.dataset.release),
              response = await fetch(
                "/api/downloads/" + encodeURIComponent(r.id) + "/file",
                {
                  headers: {
                    Authorization:
                      "Bearer " + localStorage.getItem("WQT_AUTH_TOKEN"),
                  },
                  cache: "no-store",
                },
              );
            if (!response.ok) throw new Error((await response.json()).error);
            downloadBlob(await response.blob(), r.filename);
            $("#page-error").textContent = "资料已接收，请查看浏览器下载列表。";
          } finally {
            b.disabled = false;
          }
        })),
  );
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function me(tab = "profile") {
  show(
    "me",
    `<nav class="account-tabs">${[
      ["profile", "个人信息"],
      ["study", "守望学习"],
      ["activities", "活动"],
      ["history", "活动记录"],
      ["files", "报告与录音"],
      ["feedback", "反馈"],
    ]
      .map(
        ([id, title]) =>
          `<button data-tab="${id}" class="${tab === id ? "active" : ""}">${title}</button>`,
      )
      .join(
        "",
      )}</nav><div id="account-content" class="flow-surface" data-ready="false">${loadingPanel()}</div><p id="page-error" role="alert"></p>`,
  );
  root
    .querySelectorAll("[data-tab]")
    .forEach((b) => (b.onclick = () => safe(() => me(b.dataset.tab))));
  root.dataset.accountTab=tab;
  if(tab==='feedback'){
    $('#account-content').tabIndex=0;
    $('#account-content').setAttribute('aria-label','反馈内容');
  }
  const current = generation;
  let html = "";
  if (tab === "profile") {
    user=(await request("/api/me")).user;localStorage.setItem("WQT_USER_CACHE",JSON.stringify(user));
    html=`<div class="profile-grid"><div><section class="surface"><div class="avatar" aria-hidden="true">伍</div><h2 class="profile-name">${esc(user.guardianName||'守望者')}</h2><p class="profile-caption">${esc(account.name)}</p><dl class="facts"><div><dt>真实姓名</dt><dd>${esc(user.realName||'未填写')}</dd></div><div><dt>组织</dt><dd>${esc(account.organization_name||'—')}</dd></div></dl><div class="toolbar">${button('切换账号','switch-account')}${button('退出登录','logout')}</div></section><section class="surface"><h2>账号权益</h2><p>${user.validityValid?'当前账号权益有效':'当前账号无有效付费权益'}</p><p class="profile-caption">${account.valid_until?'有效期至 '+new Date(Number(account.valid_until)).toLocaleDateString():'有效期以当前账号授权为准'}</p><div class="toolbar">${button('等级申请','level-application')}${button('权益与体验','entitlements')}</div></section></div><div><section class="surface"><h2>修改信息</h2><form id="profile-form"><div class="form-grid">${formField('realName','真实姓名',user.realName,'maxlength="40"')}${formField('guardianName','守望者名',user.guardianName,'required maxlength="40"')}</div><div class="toolbar"><button class="button primary">保存资料</button></div></form></section><section class="surface"><h2>账号安全</h2><p class="profile-caption">登录密码属于本人身份，切换组织账号无需分别设置密码。</p>${button('修改密码','change-password')}${button('当前登录会话','login-session')}</section><section class="surface"><h2>资料下载</h2>${button('↓ 下载中心','profile-downloads')}</section></div></div>`;
  }else if(tab==='history'){
 const data=await request('/api/me/sessions');html='<h1>活动记录</h1><p class="section-caption">回看带领过的场次与结算记录。</p><div class="content-list">'+(data.sessions.map((item,i)=>`<article class="list-row"><span class="list-icon" aria-hidden="true">${String(i+1).padStart(2,'0')}</span><div><h3>${esc(item.location||'场次 '+item.id)}</h3><p>${new Date(Number(item.started_at)).toLocaleString()} <span class="status-pill ${item.ended_at?'':'live'}">${item.ended_at?'已结算':'进行中'}</span></p></div>${item.player_state_json?`<button class="button" data-session="${item.id}">查看本局　↗</button>`:`<button class="button" data-legacy-session="${item.id}">查看记录　↗</button>`}</article>`).join('')||emptyPanel('还没有活动记录','完成一场游戏后，可以在这里回看。'))+'</div>';
 }else if(tab==='files'){
 const data=await request('/api/me/files');html='<h1>报告与录音</h1><p class="section-caption">保存下来的复盘报告和现场录音。</p><div class="content-list">'+(data.files.map(f=>`<article class="list-row"><span class="list-icon media-icon" aria-hidden="true">${f.type==='audio'?'♪':'▤'}</span><div><span class="list-kicker">${f.type==='audio'?'现场录音':f.type==='report_html'?'复盘报告':'场次资料'}</span><h3>${esc(f.filename||f.name||'场次文件')}</h3></div><button class="button" data-file="${esc(String(f.url||'').split('/').pop())}" data-filename="${esc(f.filename||f.name||'场次文件')}">下载　↓</button></article>`).join('')||emptyPanel('还没有保存的文件','录音或复盘报告保存后，会显示在这里。','▤'))+'</div>';
  } else if(tab==='study'){
    html=`<section class="surface learning-entry"><div><h1>守望者学习网站</h1><p>继续课程与进阶学习。</p></div><a class="button primary learning-link" href="https://learning.ai5000days.com" target="_blank" rel="noopener noreferrer">前往学习网站　↗</a></section><div class="learning-grid">${['学习权益','学习进度','进阶测试','守望者数据统计'].map(n=>`<section class="surface"><h2>${n}</h2><strong class="not-connected">待接入</strong></section>`).join('')}</div><details class="legacy-study"><summary>卡牌预习资料</summary><button class="button" id="study-materials" ${user.validityValid?"":"disabled"}>${user.validityValid?"查看卡牌资料":"有效付费权益可查看"}</button></details>`;
  } else if (tab === "activities") {
    const data = await request("/api/me/activities");
    html =
      '<h1>活动</h1><p class="section-caption">参与的活动与带领记录。</p><div class="toolbar"><button class="button" id="create-activity">活动创建 / 申请</button><button class="button" id="created-activities">我创建的活动</button></div>' +
      (data.activities.length ? data.activities
        .map(
          (a) =>
            `<article class="surface"><h3>${esc(a.name)}</h3><p>${esc(a.activity_code||"活动码待定")}</p></article>`,
        )
        .join("") : emptyPanel("还没有参与活动","通过活动码开始游戏后，这里会保留参与记录。"));
  } else if (tab === "feedback") {
    await refreshPending();
    html =
      "<h1>本场反馈</h1>" + (pending.length?`<div class="feedback-overview"><p>还有 <strong>${pending.length}</strong> 场待完成反馈</p><label>选择场次<select id="survey-select">${pending.map(item=>`<option value="${item.id}">${esc(item.location||'场次 '+item.id)} · ${new Date(Number(item.ended_at)).toLocaleString()}</option>`).join('')}</select></label></div>`:emptyPanel('所有场次反馈已完成','谢谢你的现场反馈，期待下一次带领。')) +
      pending
        .map(
          (s) =>
            `<form class="session-survey" data-survey="${s.id}" tabindex="0" aria-label="本场反馈问卷"><div class="survey-heading"><span class="list-kicker">待完成反馈</span><h3>${esc(s.location || "场次 " + s.id)}</h3></div>${s.questionnaire.questions.map((q) => `<label>${esc(q.label)}${q.type === "select" ? `<select name="${esc(q.id)}" required><option value="">请选择</option>${q.options.map((o) => `<option>${esc(o)}</option>`).join("")}</select>` : `<textarea name="${esc(q.id)}" required maxlength="1000" placeholder="写下你的现场观察…"></textarea>`}</label>`).join("")}<button class="button primary">提交反馈并关闭本场</button></form>`,
        )
        .join("") +
      "" +
      '<details class="feedback-other"><summary>其他意见与问题</summary><form id="general-feedback" tabindex="0" aria-label="其他意见表单"><label>意见类型<select name="type"><option value="reflection">体验反馈</option><option value="suggestion">功能建议</option><option value="bug">问题报告</option></select></label><label>内容<textarea name="content" required maxlength="1000" placeholder="哪些地方帮助了你？还有什么可以改进？"></textarea></label><button class="button">提交意见</button></form></details>';
  }
  if (generation !== current) return;
  $("#account-content").innerHTML = html;
  $("#account-content").dataset.ready="true";
  const surveySelect=$('#survey-select');
  if(surveySelect){const selectSurvey=()=>root.querySelectorAll('.session-survey').forEach(form=>{const current=form.dataset.survey===surveySelect.value;form.hidden=!current;form.inert=!current});surveySelect.onchange=selectSurvey;selectSurvey()}
  bind('switch-account',()=>chooseAccount({modal:true}));
  bind('entitlements',entitlements);bind('profile-downloads',downloads);bind('login-session',showLoginSession);
  bind('study-materials',studyMaterials);bind('created-activities',createdActivities);
  bind('create-activity',()=>dialog('活动创建 / 申请',note('当前账号模型的活动申请权限尚未开放。你可以使用活动码参与已有活动；申请开放后将直接在新版提交。')));
  root.querySelectorAll('[data-legacy-session]').forEach(b=>b.onclick=()=>safe(()=>legacySession(b.dataset.legacySession)));

  bind('change-password',()=>{dialog('修改登录密码',`<form id="password-form" class="flow-form">${formField('oldPassword','原密码','','type="password" required autocomplete="current-password"')}${formField('newPassword','新密码','','type="password" required minlength="6" autocomplete="new-password"')}${formField('repeat','确认新密码','','type="password" required minlength="6" autocomplete="new-password"')}<button class="button primary">保存密码</button></form>`);$('#password-form').onsubmit=e=>{e.preventDefault();safe(async()=>{const data=Object.fromEntries(new FormData(e.target));if(data.newPassword!==data.repeat)throw new Error('两次密码不一致');await request('/api/me/password',{method:'PUT',body:{oldPassword:data.oldPassword,newPassword:data.newPassword}});closeDialog();localStorage.removeItem('WQT_AUTH_TOKEN');user=null;state=null;session=null;login()})}});
  bind('level-application',async()=>{const data=await request('/api/me/level-application');dialog('等级申请',`<p>${data.application?'当前申请状态：'+esc(data.application.status):'暂无申请记录'}</p><form id="level-form"><label>申请理由<textarea name="reason" required maxlength="1000"></textarea></label><button class="button primary">提交申请</button></form>`);$('#level-form').onsubmit=e=>{e.preventDefault();safe(async()=>{await request('/api/me/level-application',{body:Object.fromEntries(new FormData(e.target))});closeDialog();await me()})}});
  bind("logout", async () => {
    await stopRecording();
    await request("/api/auth/logout", { body: {} });
    localStorage.removeItem("WQT_AUTH_TOKEN");
    localStorage.removeItem("WQT_USER_CACHE");
    user = null;
    state = null;
    session = null;
    await restoreAudioDraft();
    entry();
  });
  if ($("#profile-form"))
    $("#profile-form").onsubmit = (e) => {
      e.preventDefault();
      safe(async () => {
        const data = await request("/api/me/profile", {
          method: "PUT",
          body: Object.fromEntries(new FormData(e.target)),
        });
        user = data.user;
        localStorage.setItem("WQT_USER_CACHE", JSON.stringify(user));
        await me();
      });
    };
  root.querySelectorAll("[data-session]").forEach(
    (b) =>
      (b.onclick = () =>
        safe(async () => {
          const data = await request(
            "/api/player/session/" + b.dataset.session,
          );
          session = data.session;
          state = data.state;
          events = data.events;
          await loadCards(session.card_group_id);
          card = null;
          game();
        })),
  );
  root.querySelectorAll("[data-file]").forEach(
    (b) =>
      (b.onclick = () =>
        safe(async () => {
          const response = await fetch("/api/session-files/" + b.dataset.file, {
            headers: {
              Authorization: "Bearer " + localStorage.getItem("WQT_AUTH_TOKEN"),
            },
          });
          if (!response.ok) throw new Error("文件暂不可下载");
          downloadBlob(await response.blob(), b.dataset.filename || "场次文件");
        })),
  );
  root.querySelectorAll("[data-study]").forEach(
    (b) =>
      (b.onclick = () => {
        const c = window.playerStudyCards.find(
          (c) => c.id === Number(b.dataset.study),
        );
        dialog(
          esc(c.title),
          `<p>${esc(c.event)}</p><p>${esc(c.subtopic || "")}</p><p>${esc(c.whitepaperRef || "")}</p>${c.trainerMaterial ? `<article class="skill-analysis-piece"><div><h3>带领者参考</h3><p>${esc(c.trainerMaterial.mentorIndex)}</p><p>${esc(c.trainerMaterial.trainerNotes)}</p><p>${esc(c.trainerMaterial.extraCases)}</p></div></article>` : ""}${Object.entries(
            c.options,
          )
            .map(
              ([k, o]) =>
                `<article class="skill-analysis-piece"><span>${k}</span><div><p>${esc(o.text)}</p><p>${esc(o.consequence)}</p><p>${esc(o.reason)}</p></div></article>`,
            )
            .join("")}`,
        );
      }),
  );
  root.querySelectorAll("[data-survey]").forEach(
    (f) =>
      (f.onsubmit = (e) => {
        e.preventDefault();
        safe(async () => {
          await write("/api/player/feedback", {
            sessionId: Number(f.dataset.survey),
            answers: Object.fromEntries(new FormData(f)),
          });
          await me("feedback");
        });
      }),
  );
  if ($("#general-feedback"))
    $("#general-feedback").onsubmit = (e) => {
      e.preventDefault();
      safe(async () => {
        await request("/api/me/feedback", {
          body: Object.fromEntries(new FormData(e.target)),
        });
        e.target.reset();
        $("#page-error").textContent = "反馈已保存";
      });
    };
}
// Refresh preserves server state, never trusts local score drafts.
setInterval(() => {
  const el = $("#clock");
  if (el) el.textContent = clock();
  if (state && !state.ended && !state.paused && clock() === "0 秒" && !busy && !autoEnding)
    safe(async () => {
      autoEnding=true;
      await action("finish");
      ended();
    });
}, 1000);
window.addEventListener("storage", (e) => {
  if (e.key === "WQT_AUTH_TOKEN") {
    generation++;
    aiController?.abort();
    closeDialog();
    state = null;
    session = null;
    user = null;
    account = null;
    safe(async()=>{await stopRecording();await restoreAudioDraft();if(e.newValue)await resumeLogin();else entry()});
  }
});
window.addEventListener("beforeunload", (e) => {
  if (recorder?.state === "recording" || audioBlob || busy) {
    e.preventDefault();
    e.returnValue = "";
  }
});
setInterval(() => {
  if (view === "entry" && !document.hidden) refreshBrand();
}, 30000);
window.addEventListener("focus", () => {
  if (view === "entry") refreshBrand();
});
window.addEventListener("pagehide", () => {
  aiController?.abort();
  speechSynthesis?.cancel();
});
safe(resumeLogin);
