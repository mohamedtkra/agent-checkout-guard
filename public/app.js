const $ = (selector) => document.querySelector(selector);

const STATUS_LABELS = {
  completed: 'Paid',
  blocked: 'Blocked',
  pending: 'Needs approval',
  authorized: 'Cleared',
  denied: 'Denied',
  canceled: 'Canceled',
  refunded: 'Refunded',
};
const ACTOR_LABELS = { customer: 'You', agent: 'Agent', guard: 'Guard', payment: 'Test payment', refund: 'Refunds' };
const PARENT_TABS = { report: 'activity', refund: 'refunds' };

const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const toCents = (value) => Math.round(Number(value) * 100);
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
const day = (iso) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
const dayAndTime = (iso) => `${day(iso)}, ${new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

let state = null;
let formDirty = false;
let renderedRules = '';
let currentTab = 'rules';
let reportPurchaseId = null;
let openRefundId = null;
const seenPending = new Set();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, onClick) {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
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

async function act(path, body, success) {
  try {
    await post(path, body);
    if (success) toast(success);
  } catch (error) {
    toast(error.message);
  }
}

function showTab(name) {
  currentTab = name;
  const navTab = PARENT_TABS[name] ?? name;
  document.querySelectorAll('.screen').forEach((screen) => { screen.hidden = screen.id !== `tab-${name}`; });
  document.querySelectorAll('.tabs button').forEach((node) => {
    if (node.dataset.tab === navTab) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
}

function refundFor(purchaseId) {
  return state.refunds.find((refund) => refund.purchaseId === purchaseId);
}

function openRefund(id) {
  openRefundId = id;
  renderRefundDetail();
  showTab('refund');
}

function openReport(purchaseId) {
  const purchase = state.purchases.find((p) => p.id === purchaseId);
  reportPurchaseId = purchaseId;
  const charged = purchase.status === 'completed';
  $('#report-summary').textContent = charged
    ? `${purchase.item}, ${money(purchase.amountCents)} at ${purchase.merchantName}.`
    : `${purchase.item} at ${purchase.merchantName}. Nothing was charged for this purchase, so there is nothing to refund, but you can still report it.`;
  $('#report-form').reset();
  showTab('report');
}

function reportOrView(purchaseId) {
  const refund = refundFor(purchaseId);
  if (refund) openRefund(refund.id);
  else openReport(purchaseId);
}

function purchaseCard(purchase) {
  const card = el('li', purchase.flagged ? 'card flagged' : 'card');
  const row = el('div', 'card-row');
  row.append(el('strong', '', purchase.item), el('span', 'amount', money(purchase.amountCents)));
  const meta = el('div', 'card-row');
  const merchant = purchase.overreach ? `${purchase.merchantName} · Overreach test` : purchase.merchantName;
  meta.append(el('span', 'muted', merchant), el('span', `tag ${purchase.flagged ? 'flag' : purchase.status}`, purchase.flagged ? 'Flagged' : STATUS_LABELS[purchase.status]));
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
    actions.querySelectorAll('button').forEach((node) => { node.disabled = true; });
    await act(`/api/purchases/${purchase.id}/decision`, { approve }, approve ? 'Approved.' : 'Denied.');
  };
  actions.append(button('button danger', 'Deny', decide(false)), button('button primary', 'Approve', decide(true)));
  card.append(actions);
  return card;
}

function renderHeader() {
  const { access, paused, rules, spentCents, heldCents, remainingCents } = state;
  $('#access-dot').classList.toggle('on', access.active && !paused);
  let accessText = 'Agent has no access';
  if (paused) accessText = 'Agent paused';
  else if (access.active) accessText = `Active · ${access.token}`;
  $('#access-text').textContent = accessText;
  const accessButton = $('#access-button');
  accessButton.disabled = false;
  accessButton.textContent = access.active ? 'Revoke access' : 'Give access';
  accessButton.className = access.active ? 'button danger' : 'button primary';

  const percent = (cents) => (rules.budgetCents ? Math.min(100, (cents / rules.budgetCents) * 100) : 0);
  $('#meter-spent').style.width = `${percent(spentCents)}%`;
  $('#meter-held').style.width = `${percent(heldCents)}%`;
  $('#meter-text').textContent = `${money(spentCents)} spent · ${money(heldCents)} held · ${money(remainingCents)} left of ${money(rules.budgetCents)}`;
}

function renderAlert() {
  const box = $('#alert');
  const alert = state.alerts.at(-1);
  box.hidden = !alert;
  if (!alert) {
    box.replaceChildren();
    return;
  }
  const actions = el('div', 'actions');
  actions.append(
    button('button', refundFor(alert.purchaseId) ? 'View refund' : 'Report charge', () => reportOrView(alert.purchaseId)),
    button('button', 'Resume agent', () => act('/api/agent/resume', {}, 'Agent resumed.')),
  );
  box.replaceChildren(el('strong', '', 'Charge flagged. Agent paused.'), el('p', '', alert.message), actions);
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
  $('#simulate-overreach').disabled = state.agent.running;
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
  if (fresh && currentTab !== 'report') showTab('approvals');
}

function renderLog() {
  const entries = [...state.log].reverse();
  // Each purchase gets one report button, on its newest entry.
  const withButton = new Set();
  $('#log').replaceChildren(...(entries.length ? entries.map((entry) => {
    const item = el('li', `log-entry ${entry.actor}${entry.flagged ? ' flagged' : ''}`);
    const head = el('div', 'card-row');
    head.append(el('strong', '', entry.flagged ? 'Flagged' : ACTOR_LABELS[entry.actor]), el('time', 'muted', time(entry.at)));
    item.append(head, el('p', '', entry.message));
    if (entry.purchaseId && !withButton.has(entry.purchaseId)) {
      withButton.add(entry.purchaseId);
      item.append(button('link report', refundFor(entry.purchaseId) ? 'View refund request' : 'Report a problem', () => reportOrView(entry.purchaseId)));
    }
    return item;
  }) : [el('li', 'empty', 'Nothing has happened yet.')]));
}

function refundStatus(refund) {
  return refund.timeline[refund.stageIndex].label;
}

function refundTagClass(refund) {
  return refund.outcome ?? 'open';
}

function renderRefunds() {
  const refunds = [...state.refunds].reverse();
  $('#refunds').replaceChildren(...(refunds.length ? refunds.map((refund) => {
    const card = el('li', 'card');
    const open = button('card-button', '', () => openRefund(refund.id));
    const row = el('span', 'card-row');
    row.append(el('strong', '', refund.item), el('span', 'amount', money(refund.amountCents)));
    const meta = el('span', 'card-row');
    meta.append(el('span', 'muted', `${refund.ref} · ${refund.merchantName}`), el('span', `tag ${refundTagClass(refund)}`, refundStatus(refund)));
    const expected = refund.outcome ? `Resolved ${day(refund.resolvedAt)}` : `Expected by ${day(refund.expectedResolveAt)}`;
    open.append(row, meta, el('span', 'reason block', expected));
    card.append(open);
    return card;
  }) : [el('li', 'empty', 'No refund requests yet. Report a problem from Activity.')]));
}

function simulateButtons(refund) {
  const path = `/api/refunds/${refund.id}/advance`;
  const nextIsFinal = refund.stageIndex === refund.timeline.length - 2;
  if (!nextIsFinal) return [button('button primary wide', 'Simulate next step', () => act(path))];
  if (!refund.charged) return [button('button primary wide', 'Simulate next step: Declined', () => act(path, { outcome: 'declined' }))];
  const actions = el('div', 'actions');
  actions.append(
    button('button', 'Simulate next step: Declined', () => act(path, { outcome: 'declined' })),
    button('button primary', 'Simulate next step: Refunded', () => act(path, { outcome: 'refunded' })),
  );
  return [actions];
}

function renderRefundDetail() {
  const refund = state?.refunds.find((r) => r.id === openRefundId);
  if (!refund) {
    $('#refund-detail').replaceChildren();
    return;
  }
  $('#refund-title').textContent = `Refund ${refund.ref}`;

  const summary = el('div', 'card');
  const row = el('div', 'card-row');
  row.append(el('strong', '', refund.item), el('span', 'amount', money(refund.amountCents)));
  const meta = el('div', 'card-row');
  meta.append(el('span', 'muted', refund.merchantName), el('span', `tag ${refundTagClass(refund)}`, refundStatus(refund)));
  summary.append(row, meta, el('p', 'reason', `Reason: ${refund.reasonLabel}`));
  if (refund.note) summary.append(el('p', 'reason note', `Your note: ${refund.note}`));

  let eta = `Expected to resolve in about ${refund.expectedDays} days, by ${day(refund.expectedResolveAt)}. This is a mock estimate.`;
  if (refund.outcome) eta = refund.declineReason ?? `Resolved on ${day(refund.resolvedAt)}.`;

  const timeline = el('ol', 'timeline');
  refund.timeline.forEach((step, index) => {
    const done = Boolean(step.at);
    const item = el('li', `step${done ? ' done' : ''}${index === refund.stageIndex && !refund.outcome ? ' current' : ''}`);
    item.append(el('strong', '', step.label), el('span', 'muted', done ? dayAndTime(step.at) : `Expected by ${day(step.expectedAt)}`));
    timeline.append(item);
  });

  const children = [summary, el('p', 'eta', eta), el('h3', '', 'Status timeline'), timeline];
  if (!refund.outcome) children.push(...simulateButtons(refund));
  $('#refund-detail').replaceChildren(...children);
}

function render() {
  renderHeader();
  renderAlert();
  renderRules();
  renderAgent();
  renderApprovals();
  renderLog();
  renderRefunds();
  renderRefundDetail();
}

function setLive(isLive) {
  $('#live-state').textContent = isLive ? 'Live.' : 'Reconnecting…';
}

function buildReportReasons() {
  $('#report-reasons').replaceChildren(...Object.entries(state.refundReasons).map(([value, label]) => {
    const option = el('label', 'check compact');
    const input = el('input');
    input.type = 'radio';
    input.name = 'report-reason';
    input.value = value;
    input.required = true;
    option.append(input, el('span', '', label));
    return option;
  }));
}

document.querySelectorAll('.tabs button').forEach((node) => {
  node.addEventListener('click', () => showTab(node.dataset.tab));
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

$('#access-button').addEventListener('click', () => {
  const active = !state.access.active;
  act('/api/access', { active }, active ? 'The agent has access.' : 'Access revoked.');
});

$('#run-agent').addEventListener('click', () => act('/api/agent/run'));
$('#simulate-overreach').addEventListener('click', () => act('/api/agent/overreach'));
$('#simulate-uncleared').addEventListener('click', () => act('/api/simulate/uncleared-charge'));
$('#report-back').addEventListener('click', () => showTab('activity'));
$('#refund-back').addEventListener('click', () => showTab('refunds'));

$('#report-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const before = state.refunds.length;
    const reason = document.querySelector('input[name="report-reason"]:checked').value;
    const updated = await post(`/api/purchases/${reportPurchaseId}/report`, { reason, note: $('#report-note').value });
    state = updated;
    render();
    toast('Refund request submitted.');
    openRefund(updated.refunds[before].id);
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
  const firstState = !state;
  state = JSON.parse(event.data);
  if (firstState) buildReportReasons();
  render();
};
