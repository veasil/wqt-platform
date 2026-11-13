import { createWqtClient } from '/sdk/team-client.js';
import { config } from './config.js';
const client = createWqtClient(config), names = ['安全力', '脑波力', '实感力', '创心力', '沟通力'];
const $ = selector => document.querySelector(selector), message = $('#message');
const sessionKey = 'emma-session:' + config.platformOrigin + ':' + config.clientId;
let connected = false, connection = null, sessionId = null, state = null, cards = [], busy = false;
function note(text) { message.textContent = text; }
function rememberedSession(value) {
  try {
    if (value !== undefined) sessionStorage.setItem(sessionKey, JSON.stringify(value));
    return JSON.parse(sessionStorage.getItem(sessionKey) || 'null');
  } catch { throw new Error('浏览器暂存不可用，无法恢复本次课堂。'); }
}
function pending() { return client.getPending(); }
function controls() {
  const unfinished = !!pending();
  $('#retry').hidden = !unfinished; $('#retry').disabled = busy || !connected;
  $('#start').disabled = busy || !connected || unfinished || !!(state && !state.ended);
  for (const button of document.querySelectorAll('#game button')) button.disabled = busy || !connected || unfinished || !!state?.ended;
  $('#refresh').disabled = busy || !connected; $('#login').disabled = busy;
  $('#logout').hidden = !connected;
}
async function run(work) {
  if (busy) return;
  busy = true;
  try { controls(); await work(); }
  catch (error) {
    note(error.message + (error.outcomeUnknown ? ' 结果可能已保存，请使用“重试上一项未确认的操作”。' : ''));
    if (error.status === 401) { connected = false; $('#connection').textContent = '连接已过期，请重新连接'; }
  } finally { busy = false; try { controls(); } catch (error) { note(error.message); } }
}
function renderCards() {
  const host = $('#cards'); host.replaceChildren();
  if (!cards.length || !state || state.ended) return;
  const select = document.createElement('select'); select.setAttribute('aria-label', '选择课堂卡牌'); select.id = 'card-select';
  for (const card of cards) {
    const option = document.createElement('option'); option.value = String(card.id);
    option.textContent = (card.card_code || '') + ' · ' + (card.title || card.event || '课堂卡牌'); select.append(option);
  }
  const detail = document.createElement('div');
  function chooseCard() {
    const card = cards.find(item => String(item.id) === select.value); detail.replaceChildren(); if (!card) return;
    const title = document.createElement('h3'), description = document.createElement('p'), choices = document.createElement('div');
    title.textContent = card.title || '说说你的选择'; description.textContent = card.event || ''; choices.className = 'choices';
    for (const letter of ['A', 'B', 'C']) {
      if (!card.options?.[letter]) continue;
      const button = document.createElement('button'); button.textContent = letter + ' · ' + card.options[letter].text;
      button.dataset.choice = letter; button.addEventListener('click', () => run(() => action('choice', { cardId: card.id, choice: letter })));
      choices.append(button);
    }
    detail.append(title, description, choices); controls();
  }
  select.addEventListener('change', chooseCard); host.append(select, detail); chooseCard();
}
function render() {
  $('#game').hidden = !state; $('#start-form').hidden = !!(state && !state.ended); $('#result').hidden = !state?.ended;
  if (!state) { controls(); return; }
  $('#phase').textContent = state.ended ? '课堂已完成' : ['启蒙期', '成长期', '青春期'][state.phase] + (state.paused ? ' · 已暂停' : '');
  $('#pause').textContent = state.paused ? '继续课堂' : '暂停'; $('#advance').hidden = !state.pending || state.ended;
  $('#scores').replaceChildren(); $('#adjust-fields').replaceChildren();
  names.forEach((name, index) => {
    const block = document.createElement('div'), label = document.createElement('span'), value = document.createElement('strong');
    block.className = 'score'; label.textContent = name; value.textContent = String(state.values[index]); block.append(label, value); $('#scores').append(block);
    const field = document.createElement('label'), input = document.createElement('input'); field.textContent = name;
    input.type = 'number'; input.name = 'score' + index; input.min = '0'; input.max = '10'; input.required = true; input.value = state.values[index];
    field.append(input); $('#adjust-fields').append(field);
  });
  renderCards(); controls();
}
async function restore(id = sessionId) {
  if (!id) return;
  const data = await client.getSession(Number(id)); sessionId = Number(id); state = data.state;
  rememberedSession({ id: sessionId, accountId: connection.account.id });
  cards = (await client.getCards(sessionId)).cards; render();
  if (state.ended) {
    const host = $('#result'), title = document.createElement('p'), score = document.createElement('strong');
    title.textContent = '本次课堂已保存 · 综合得分'; score.textContent = String(data.scoreOverview.finalScore);
    host.replaceChildren(title, score); note('课堂已结束。结果保存在伍仟天，刷新后仍可查看。');
  } else note('场次 ' + sessionId + ' · 当前状态已同步。');
}
async function action(actionName, fields = {}) {
  const result = await client.performAction({ sessionId, revision: state.revision, action: actionName, ...fields });
  state = result.state; await restore();
}
$('#login').addEventListener('click', () => run(() => client.login()));
$('#logout').addEventListener('click', () => run(async () => {
  client.logout(); connected = false; connection = null; state = null; cards = []; sessionId = null;
  $('#connection').textContent = '已退出课件'; $('#result').hidden = true; render();
  note('已退出本课件；伍仟天网站的登录不受影响。未确认操作仍保留，可用原账号重新连接。');
}));
$('#start-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget;
  run(async () => {
    const result = await client.startSession({ cardGroupId: Number(form.elements.cardGroupId.value), location: form.elements.location.value,
      players: [], mode: 'standard', settings: { duration: 1800, counts: [1, 1, 1] } });
    sessionId = result.sessionId; rememberedSession({ id: sessionId, accountId: connection.account.id }); await restore();
  });
});
$('#adjust-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget;
  run(() => action('adjust', { values: names.map((_, index) => Number(form.elements['score' + index].value)), reason: form.elements.reason.value }));
});
$('#pause').addEventListener('click', () => run(() => action('pause')));
$('#advance').addEventListener('click', () => run(() => action('advance')));
$('#finish').addEventListener('click', () => run(() => action('finish')));
$('#refresh').addEventListener('click', () => run(() => restore()));
$('#retry').addEventListener('click', () => run(async () => {
  const operation = pending(), result = await client.retryPending();
  sessionId = operation.path === '/api/player/start' ? result.sessionId : operation.body.sessionId;
  rememberedSession({ id: sessionId, accountId: connection.account.id }); await restore();
}));
run(async () => {
  await client.handleCallback(); connection = await client.getConnection(); connected = true;
  $('#connection').textContent = connection.account.name; const saved = rememberedSession();
  if (saved?.accountId === connection.account.id) await restore(saved.id);
  else note('已连接，可以开始课堂。');
});
