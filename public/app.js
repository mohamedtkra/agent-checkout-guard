const $ = (selector) => document.querySelector(selector);

const STATUS_LABELS = {
  completed: 'Paid',
  blocked: 'Blocked',
  pending: 'Needs approval',
  denied: 'Denied',
  canceled: 'Canceled',
};
const ACTOR_LABELS = { customer: 'You', agent: 'Agent', guard: 'Guard', payment: 'Test payment' };

const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const toCents = (value) => Math.round(Number(value) * 100);
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

let state = null;
let formDirty = false;
let renderedRules = '';
const seenPending = new Set();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let toastTimer;
function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 3500);
}

async function post(path, body = {}) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

function showTab(name) {
  document.querySelectorAll('.screen').forEach((screen) => { screen.hidden = screen.id !== `tab-${name}`; });
  document.querySelectorAll('.tabs button').forEach((button) => {
    if (button.dataset.tab === name) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
}

function purchaseCard(purchase) {
  const card = el('li', 'card');
  const row = el('div', 'card-row');
  row.append(el('strong', '', purchase.item), el('span', 'amount', money(purchase.amountCents)));
  const meta = el('div', 'card-row');
  meta.append(el('span', 'muted', purchase.merchantName), el('span', `tag ${purchase.status}`, STATUS_LABELS[purchase.status]));
  card.append(row, meta);
  if (purchase.reason) card.append(el('p', 'reason', purchase.reason));
  return card;
}

function approvalCard(purchase) {
  const card = purchaseCard(purchase);
  card.classList.add('approval');
  card.append(el('p', 'reason', `If approved, ${money(state.remainingCents)} of your budget stays available.`));
  const actions = el('div', 'actions');
  const decide = (approve) => async () => {
    actions.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
      await post(`/api/purchases/${purchase.id}/decision`, { approve });
      toast(approve ? 'Approved.' : 'Denied.');
    } catch (error) {
      toast(error.message);
    }
  };
  const deny = el('button', 'button danger', 'Deny');
  const approve = el('button', 'button primary', 'Approve');
  deny.type = 'button';
  approve.type = 'button';
  deny.addEventListener('click', decide(false));
  approve.addEventListener('click', decide(true));
  actions.append(deny, approve);
  card.append(actions);
  return card;
}

function renderHeader() {
  const { access, rules, spentCents, heldCents, remainingCents } = state;
  $('#access-dot').classList.toggle('on', access.active);
  $('#access-text').textContent = access.active ? `Active · ${access.token}` : 'Agent has no access';
  const button = $('#access-button');
  button.disabled = false;
  button.textContent = access.active ? 'Revoke access' : 'Give access';
  button.className = access.active ? 'button danger' : 'button primary';

  const percent = (cents) => (rules.budgetCents ? Math.min(100, (cents / rules.budgetCents) * 100) : 0);
  $('#meter-spent').style.width = `${percent(spentCents)}%`;
  $('#meter-held').style.width = `${percent(heldCents)}%`;
  $('#meter-text').textContent = `${money(spentCents)} spent · ${money(heldCents)} held · ${money(remainingCents)} left of ${money(rules.budgetCents)}`;
}

function renderRules() {
  $('#save-rules').textContent = state.access.active ? 'Save rules' : 'Save rules and give agent access';
  const serialized = JSON.stringify(state.rules);
  if (formDirty || serialized === renderedRules) return;
  renderedRules = serialized;
  $('#budget').value = (state.rules.budgetCents / 100).toFixed(2);
  $('#approval').value = (state.rules.approvalCents / 100).toFixed(2);
  const options = $('#merchant-options');
  options.replaceChildren(...state.merchants.map((merchant) => {
    const label = el('label', 'check');
    const input = el('input');
    input.type = 'checkbox';
    input.value = merchant.id;
    input.checked = state.rules.allowedMerchantIds.includes(merchant.id);
    const text = el('span');
    text.append(el('strong', '', merchant.name), el('span', 'muted', merchant.category));
    label.append(input, text);
    return label;
  }));
}

function renderAgent() {
  $('#agent-status').textContent = !state.access.active && !state.agent.running && !state.purchases.length
    ? 'The agent has no access yet, so its purchases will be blocked.'
    : state.agent.message;
  $('#run-agent').disabled = state.agent.running;
  $('#run-agent').textContent = state.agent.running ? 'Agent is shopping…' : 'Send agent shopping';
  const purchases = [...state.purchases].reverse();
  $('#purchases').replaceChildren(...(purchases.length ? purchases.map(purchaseCard) : [el('li', 'empty', 'No purchases yet.')]));
}

function renderApprovals() {
  const pending = state.purchases.filter((purchase) => purchase.status === 'pending');
  $('#approvals').replaceChildren(...(pending.length ? pending.map(approvalCard) : [el('li', 'empty', 'Nothing is waiting for you.')]));
  const badge = $('#approval-badge');
  badge.hidden = pending.length === 0;
  badge.textContent = pending.length;

  const fresh = pending.find((purchase) => !seenPending.has(purchase.id));
  pending.forEach((purchase) => seenPending.add(purchase.id));
  if (fresh) showTab('approvals');
}

function renderLog() {
  const entries = [...state.log].reverse();
  $('#log').replaceChildren(...(entries.length ? entries.map((entry) => {
    const item = el('li', `log-entry ${entry.actor}`);
    const head = el('div', 'card-row');
    head.append(el('strong', '', ACTOR_LABELS[entry.actor]), el('time', 'muted', time(entry.at)));
    item.append(head, el('p', '', entry.message));
    return item;
  }) : [el('li', 'empty', 'Nothing has happened yet.')]));
}

function render() {
  renderHeader();
  renderRules();
  renderAgent();
  renderApprovals();
  renderLog();
}

function setLive(isLive) {
  $('#live-state').textContent = isLive ? 'Live.' : 'Reconnecting…';
}

document.querySelectorAll('.tabs button').forEach((button) => {
  button.addEventListener('click', () => showTab(button.dataset.tab));
});

$('#rules-form').addEventListener('input', () => { formDirty = true; });

$('#rules-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const allowedMerchantIds = [...document.querySelectorAll('#merchant-options input:checked')].map((input) => input.value);
  try {
    await post('/api/rules', {
      budgetCents: toCents($('#budget').value),
      approvalCents: toCents($('#approval').value),
      allowedMerchantIds,
    });
    formDirty = false;
    if (!state.access.active) await post('/api/access', { active: true });
    toast('Rules saved.');
    showTab('agent');
  } catch (error) {
    toast(error.message);
  }
});

$('#access-button').addEventListener('click', async () => {
  const active = !state.access.active;
  try {
    await post('/api/access', { active });
    toast(active ? 'The agent has access.' : 'Access revoked.');
  } catch (error) {
    toast(error.message);
  }
});

$('#run-agent').addEventListener('click', async () => {
  try {
    await post('/api/agent/run');
  } catch (error) {
    toast(error.message);
  }
});

$('#reset').addEventListener('click', async () => {
  try {
    formDirty = false;
    renderedRules = '';
    seenPending.clear();
    await post('/api/reset');
    toast('Demo reset.');
    showTab('rules');
  } catch (error) {
    toast(error.message);
  }
});

const events = new EventSource('/api/events');
events.onopen = () => setLive(true);
events.onerror = () => setLive(false);
events.onmessage = (event) => {
  state = JSON.parse(event.data);
  render();
};
