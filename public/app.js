import { agentFilter, agentHistory, allClear, approvalRows, approvalSheet, balanceCard, button, codeBubble, el, factList, hideSheet, icon, image, liveStatus, planList, planSummary, receipt, revokeConfirm, revokeDone, selectedPlanItems, showSheet, steps, successPanel, trailList, transactionList, trustLabel, trustPicker } from './shared/ui.js';

const $ = (selector) => document.querySelector(selector);

const CONNECTION_LABELS = { active: 'Active', expired: 'Expired', revoked: 'Revoked' };
const ACTOR_LABELS = { customer: 'You', agent: 'Agent', guard: 'Guard', payment: 'Test payment', refund: 'Refunds', reminder: 'Reminder', clock: 'Test clock', merchant: 'Merchant', security: 'Security' };
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CONNECTION_DAYS = 30;
const PARENT_TABS = { report: 'activity', refund: 'activity', purchase: 'activity', connect: 'agents', agent: 'agents', revoke: 'agents', plan: 'home' };
// An approval request waits for the customer on these screens rather than interrupting them.
const UNINTERRUPTED_TABS = ['report', 'connect', 'plan', 'revoke'];
const CONNECT_STEPS = ['Verify', 'Limits', 'Review'];
const TAB_TITLES = { home: 'Home', agents: 'Agents', activity: 'Activity', rules: 'Rules' };
const APPROVAL_WARNING = "Approval doesn't reserve funds; this can still fail if your limit is used up first.";

const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const toCents = (value) => Math.round(Number(value) * 100);
const time = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
const day = (iso) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
const utcDay = (iso) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const dayAndTime = (iso) => `${day(iso)}, ${new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

let state = null;
let events = null;
let currentUser = null;
let signInEmail = '';
let formDirty = false;
let renderedRules = '';
let renderedConnections = '';
let currentTab = 'home';
let activitySegment = 'purchases';
let planConnectionId = null;
let selectedAgentId = null;
let sheetPurchaseId = null;
let sheetKey = null;
let trustChoice = 'every_time';
let reportPurchaseId = null;
let openRefundId = null;
let openPurchaseId = null;
let purchaseReturnTab = 'activity';
let connectFlow = null;
let revokeFlow = null;
let historyConnectionId = null;
let activityAgentId = null;
const seenPending = new Set();

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
  if (response.status === 401 && !path.startsWith('/api/auth/')) showSignedOut(data.error);
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
  $('#appbar-title').textContent = TAB_TITLES[navTab];
  document.querySelectorAll('.screen').forEach((screen) => { screen.hidden = screen.id !== `tab-${name}`; });
  document.querySelectorAll('.tabs button').forEach((node) => {
    if (node.dataset.tab === navTab) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
}

function showSegment(name) {
  activitySegment = name;
  document.querySelectorAll('[data-segment]').forEach((node) => node.setAttribute('aria-pressed', String(node.dataset.segment === name)));
  ['purchases', 'log', 'refunds'].forEach((segment) => { $(`#segment-${segment}`).hidden = segment !== name; });
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

const wasCharged = (purchase) => ['completed', 'refunded'].includes(purchase.status);

function openPurchase(id) {
  openPurchaseId = id;
  purchaseReturnTab = currentTab;
  renderPurchaseDetail();
  showTab('purchase');
}

const detailList = factList;

function renderPurchaseDetail() {
  const purchase = state?.purchases.find((p) => p.id === openPurchaseId);
  if (!purchase) {
    $('#purchase-detail').replaceChildren();
    return;
  }
  const seller = el('div', 'card');
  const merchant = state.merchants.find((m) => m.id === purchase.merchantId);
  const head = el('div', 'merchant-head');
  const name = el('div');
  name.append(el('strong', '', purchase.merchantName));
  if (merchant) name.append(el('p', 'muted small', merchant.category));
  head.append(image('logo large', purchase.merchantLogo), name);
  seller.append(head);
  if (merchant) {
    seller.append(factList([['About', merchant.about], ['Address', merchant.location], ['Support', merchant.support], ['Returns', merchant.returns]]));
  } else {
    seller.append(el('p', 'reason', 'No merchant information is available for this charge.'));
  }
  const { signal } = purchase;
  const yesNo = (value, yes, no) => (signal ? (value ? yes : no) : null);
  $('#purchase-detail').replaceChildren(receipt(purchase, {
    money,
    dateText: dayAndTime(purchase.settledAt ?? purchase.at),
    rows: [
      ['Quoted price', purchase.originalCents ? money(purchase.originalCents) : null],
      ['Color', purchase.color],
      ['Size', purchase.size],
      ['Category', purchase.category],
      ['Agent', purchase.agentName],
      ['Agent verified by merchant', signal ? yesNo(signal.agentVerified, 'Yes', 'No') : null],
      ['You were present', signal ? yesNo(signal.customerPresent, 'Yes, you approved it', 'No, within your limits') : null],
      ['Consent used', signal ? `Version ${signal.consentVersion}` : null],
    ],
    merchantInfo: seller,
    actions: [button('button wide spaced', refundFor(purchase.id) ? 'View refund request' : 'Report a problem', () => reportOrView(purchase.id))],
  }));
}

function closeApproval() {
  sheetPurchaseId = null;
  sheetKey = null;
  hideSheet($('#sheet'));
}

function renderApprovalSheet() {
  if (!sheetPurchaseId) return;
  const purchase = state.purchases.find((p) => p.id === sheetPurchaseId && p.status === 'pending');
  if (!purchase) {
    closeApproval();
    return;
  }
  const key = `${purchase.id}:${purchase.reminder}`;
  if (key === sheetKey) return;
  sheetKey = key;
  const daysLeft = Math.ceil((Date.parse(purchase.expiresAt) - Date.parse(state.now)) / DAY_MS);
  const countdown = purchase.reminder ?? `${day(purchase.expiresAt)} (${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left)`;
  const path = `/api/purchases/${purchase.id}`;
  showSheet($('#sheet'), approvalSheet(purchase, {
    money,
    countdown,
    warning: APPROVAL_WARNING,
    onApprove: () => act(`${path}/decision`, { approve: true }, 'Approved.'),
    onDeny: () => act(`${path}/decision`, { approve: false }, 'Denied.'),
    onTakeOver: () => act(`${path}/takeover`, {}, 'Okay. The agent will leave this one to you.'),
  }), closeApproval);
}

function openApproval(id) {
  sheetPurchaseId = id;
  sheetKey = null;
  renderApprovalSheet();
}

const activeConnections = () => state.connections.filter((connection) => connection.status === 'active');

function renderHeader() {
  const { paused } = state;
  const stop = $('#stop-all');
  stop.hidden = activeConnections().length === 0 && !paused;
  stop.textContent = paused ? 'Resume agents' : 'Stop all agents';
  stop.className = paused ? 'stop-pill resume' : 'stop-pill';
  $('#account-email').textContent = `Signed in as ${currentUser.email}`;
}

function spendBar(spentCents, heldCents, scaleCents, label) {
  const bar = el('div', 'spend-bar');
  bar.title = label;
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', label);
  [['spent', spentCents], ['held', heldCents]].filter(([, cents]) => cents > 0).forEach(([kind, cents]) => {
    const segment = el('span', kind);
    segment.style.width = `${scaleCents ? Math.min(100, (cents / scaleCents) * 100) : 0}%`;
    bar.append(segment);
  });
  return bar;
}

function stats(rows) {
  const list = el('dl', 'stats');
  list.append(...rows.map(([label, cents]) => {
    const stat = el('div', 'stat');
    stat.append(el('dt', '', label), el('dd', '', money(cents)));
    return stat;
  }));
  return list;
}

function renderSpending() {
  const { spendingByAgent, spendingByCategory } = state;
  $('#spending-agents').replaceChildren(...(spendingByAgent.length ? spendingByAgent.map((row) => {
    const card = el('li', 'card');
    const head = el('div', 'merchant-head');
    head.append(image('logo', row.icon), el('strong', '', row.name));
    const label = `${row.name}: ${money(row.spentCents)} spent, ${money(row.heldCents)} on hold, ${money(row.remainingCents)} remaining of ${money(row.allocationCents)}`;
    card.append(head, spendBar(row.spentCents, row.heldCents, row.allocationCents, label), stats([
      [row.shared ? 'Shared' : 'Allocation', row.allocationCents],
      ['Spent', row.spentCents],
      ['On hold', row.heldCents],
      ['Remaining', row.remainingCents],
    ]));
    return card;
  }) : [el('li', 'empty', 'No agents connected yet.')]));

  const largest = Math.max(...spendingByCategory.map((row) => row.spentCents + row.heldCents), 0);
  $('#spending-categories').replaceChildren(...(spendingByCategory.length ? spendingByCategory.map((row) => {
    const card = el('li', 'card');
    const head = el('div', 'card-row');
    const name = el('span', 'merchant');
    name.append(image('category-icon', row.icon), el('strong', '', row.category));
    head.append(name, el('span', 'amount', money(row.spentCents + row.heldCents)));
    const detail = `${money(row.spentCents)} spent · ${money(row.heldCents)} on hold`;
    card.append(head, spendBar(row.spentCents, row.heldCents, largest, `${row.category}: ${detail}`), el('p', 'reason', detail));
    return card;
  }) : [el('li', 'empty', 'No spending yet.')]));
}

function renderHome() {
  const { allocation, holds, paused, agent, purchases } = state;
  const active = activeConnections().length;
  let status = 'No agents connected';
  if (paused) status = state.pauseReason === 'You stopped all agents.' ? 'Agents stopped' : 'Agents paused';
  else if (active) status = `${active} ${active === 1 ? 'agent' : 'agents'} active`;
  $('#home-hero').replaceChildren(balanceCard({
    label: 'Available to your agents',
    amount: money(allocation.remainingCents),
    sub: `of ${money(allocation.totalCents)} agent allocation`,
    status,
    statusOff: paused || active === 0,
    spentCents: allocation.spentCents,
    heldCents: allocation.heldCents,
    totalCents: allocation.totalCents,
    money,
  }));
  $('#agent-live').replaceChildren(...(agent.running ? [liveStatus(agent.message)] : []));
  $('#recent-section').hidden = purchases.length === 0;
  $('#recent').replaceChildren(transactionList(purchases.slice(-4), { money, day, onOpen: openPurchase }));
  renderSpending();
  $('#holds').replaceChildren(...(holds.length ? holds.map((hold) => {
    const card = el('li', 'card');
    const row = el('div', 'card-row');
    row.append(el('strong', '', hold.item), el('span', 'amount', money(hold.amountCents)));
    const merchant = el('span', 'merchant');
    merchant.append(image('logo', hold.merchantLogo), el('span', 'muted small', `${hold.merchantName} · ${hold.agentName}`));
    card.append(row, merchant, el('p', 'reason', `Hold expires ${day(hold.expiresAt)}`));
    return card;
  }) : [el('li', 'empty', 'No open holds.')]));
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
    button('button', 'Resume agents', () => act('/api/agent/resume', {}, 'Agents resumed.')),
  );
  box.replaceChildren(el('strong', '', 'Charge flagged. Agents paused.'), el('p', '', alert.message), actions);
}

function renderReminders() {
  const box = $('#reminders');
  const reminders = state.purchases.filter((purchase) => purchase.status === 'pending' && purchase.reminder);
  box.hidden = reminders.length === 0;
  box.replaceChildren(...reminders.map((purchase) => {
    const notice = el('div', 'reminder-notice');
    const text = el('div');
    text.append(el('strong', '', purchase.reminder), el('p', '', `${purchase.item} at ${purchase.merchantName}, ${money(purchase.amountCents)}`));
    notice.append(text, button('button', 'Review', () => { showTab('home'); openApproval(purchase.id); }));
    return notice;
  }));
}

function openHistory(connectionId) {
  historyConnectionId = connectionId;
  renderHistory();
  showTab('agent');
}

function renderHistory() {
  const connection = state?.connections.find((c) => c.id === historyConnectionId);
  if (!connection) {
    $('#agent-detail').replaceChildren();
    return;
  }
  $('#agent-detail').replaceChildren(agentHistory({ connection, purchases: state.purchases, money, day, onOpen: openPurchase }));
}

function openRevoke(connection) {
  revokeFlow = { connectionId: connection.id, result: null, busy: false };
  renderRevoke();
  showTab('revoke');
}

function endRevoke() {
  revokeFlow = null;
  showTab('agents');
}

async function confirmRevoke() {
  if (revokeFlow.busy) return;
  revokeFlow.busy = true;
  try {
    const { revocation } = await post(`/api/connections/${revokeFlow.connectionId}/revoke`);
    revokeFlow.result = revocation;
    renderRevoke();
  } catch (error) {
    revokeFlow.busy = false;
    toast(error.message);
  }
}

// The confirmation stays current while the agent works, so it always lists what would really stop.
function renderRevoke() {
  if (!revokeFlow) return;
  if (revokeFlow.result) {
    if (revokeFlow.shown) return;
    revokeFlow.shown = true;
    const { connectionId } = revokeFlow;
    $('#revoke-body').replaceChildren(revokeDone({
      result: revokeFlow.result,
      money,
      onBack: endRevoke,
      onHistory: () => { revokeFlow = null; openHistory(connectionId); },
    }));
    window.scrollTo(0, 0);
    return;
  }
  const connection = state.connections.find((c) => c.id === revokeFlow.connectionId && c.status === 'active');
  if (!connection) {
    toast('This agent is no longer connected.');
    endRevoke();
    return;
  }
  $('#revoke-body').replaceChildren(revokeConfirm({ connection, purchases: state.purchases, money, onKeep: endRevoke, onRevoke: confirmRevoke }));
}

function connectionCard(connection) {
  const card = el('li', connection.status === 'active' ? 'card' : 'card inactive');
  const head = el('div', 'card-row');
  const identity = el('div', 'merchant-head');
  const name = el('div');
  name.append(el('strong', '', connection.name), el('p', 'muted small', trustLabel(connection.permissions.trustLevel)));
  identity.append(image('logo large', connection.icon), name);
  head.append(identity, el('span', `tag ${connection.status}`, CONNECTION_LABELS[connection.status]));

  const { permissions, consent } = connection;
  const facts = el('dl', 'agent-facts');
  [['Spent', money(connection.spentCents)], ['Budget', money(permissions.budgetCents)], ['Expires', utcDay(permissions.connectionExpiresAt)]].forEach(([label, value]) => {
    const fact = el('div');
    fact.append(el('dt', '', label), el('dd', '', value));
    facts.append(fact);
  });
  card.append(head, facts);

  const more = el('details', 'why-trail');
  more.append(el('summary', '', 'All permissions'), factList([
    ['Ask for approval above', permissions.approvalCents === 0 ? 'Every purchase' : money(permissions.approvalCents)],
    ['Approval requests expire after', `${permissions.approvalExpiryDays} days`],
    ['Connected', dayAndTime(connection.connectedAt)],
    ['Last activity', connection.lastActivityAt ? dayAndTime(connection.lastActivityAt) : 'None yet'],
    ['Revoked', connection.revokedAt ? dayAndTime(connection.revokedAt) : null],
    ['Test card token', connection.token],
    ['Signed consent', `Version ${consent.version}, ${consent.verified ? 'signature verified' : 'signature invalid'}`],
  ]));
  const record = el('details', 'consent-record why-trail');
  record.append(el('summary', '', 'Signed consent record'), el('pre', '', JSON.stringify({
    mandate: JSON.parse(consent.mandateJson),
    signature: consent.signature,
    algorithm: 'Ed25519',
    keyId: consent.keyId,
  }, null, 2)));
  more.append(record);
  const attempts = state.purchases.filter((p) => p.connectionId === connection.id).length;
  card.append(more, button('link agent-history-link', `Purchase history (${attempts})`, () => openHistory(connection.id)));

  if (connection.status === 'active') {
    const actions = el('div', 'actions');
    actions.append(
      button('button', 'Revoke', () => openRevoke(connection)),
      button('button', 'Edit permissions', () => startConnect(state.demoAgents.find((a) => a.id === connection.agentId), connection)),
    );
    card.append(actions);
  }
  return card;
}

function renderConnections() {
  const available = state.demoAgents.filter((agent) => !activeConnections().some((c) => c.agentId === agent.id));
  const serialized = JSON.stringify([state.connections, available.map((a) => a.id), state.purchases.length]);
  if (serialized === renderedConnections) return;
  renderedConnections = serialized;

  $('#connections').replaceChildren(...(state.connections.length ? state.connections.map(connectionCard) : [el('li', 'empty', 'No agents connected yet.')]));
  $('#available-agents').replaceChildren(...(available.length ? available.map((agent) => {
    const card = el('li', 'card');
    const row = el('div', 'card-row');
    const identity = el('div', 'merchant-head');
    identity.append(image('logo large', agent.icon), el('strong', '', agent.name));
    row.append(identity, button('button primary', 'Connect', () => startConnect(agent)));
    card.append(row);
    return card;
  }) : [el('li', 'empty', 'All demo agents are connected.')]));
}

function showConnectStage(stage) {
  connectFlow.stage = stage;
  $('#stepup-form').hidden = stage !== 'stepup';
  $('#limits-form').hidden = stage !== 'limits';
  $('#consent-review').hidden = stage !== 'consent';
  $('#connect-done').hidden = stage !== 'done';
  $('#connect-header').hidden = stage === 'done';
  $('#connect-back').hidden = stage === 'done';
  if (stage !== 'done') $('#connect-steps').replaceChildren(steps(CONNECT_STEPS, ['stepup', 'limits', 'consent'].indexOf(stage)));
  window.scrollTo(0, 0);
}

function fillCode(input, code) {
  input.value = code;
  input.form.requestSubmit();
}

async function startConnect(agent, connection = null) {
  try {
    const challenge = await post('/api/connections/step-up', connection ? { connectionId: connection.id } : { agentId: agent.id });
    connectFlow = { agent, connection, challengeId: challenge.challengeId, permissions: null };
    $('#connect-title').textContent = connection ? 'Edit permissions' : 'Connect an agent';
    const name = el('strong', '', agent.name);
    $('#connect-agent').replaceChildren(image('logo large', agent.icon), name);
    $('#stepup-bubble').replaceChildren(codeBubble(challenge.demoCode, () => fillCode($('#stepup-input'), challenge.demoCode)));
    $('#stepup-input').value = '';
    showConnectStage('stepup');
    showTab('connect');
  } catch (error) {
    toast(error.message);
  }
}

function fillLimitsForm() {
  const { connection } = connectFlow;
  const limits = connection?.permissions ?? state.rules;
  trustChoice = connection?.permissions.trustLevel ?? 'every_time';
  $('#trust-options').replaceChildren(trustPicker(trustChoice, (level) => {
    trustChoice = level;
    $('#limit-approval-field').hidden = level !== 'above';
  }));
  $('#limit-approval-field').hidden = trustChoice !== 'above';
  $('#limit-budget').value = (limits.budgetCents / 100).toFixed(2);
  $('#limit-approval').value = (limits.approvalCents / 100).toFixed(2);
  $('#limit-budget').max = (state.rules.budgetCents / 100).toFixed(2);
  $('#limit-approval').max = (state.rules.approvalCents / 100).toFixed(2);
  const expiry = connection?.permissions.connectionExpiresAt ?? new Date(Date.parse(state.now) + DEFAULT_CONNECTION_DAYS * DAY_MS).toISOString();
  $('#limit-expiry').value = expiry.slice(0, 10);
  $('#limit-expiry').min = state.now.slice(0, 10);
}

function renderConsent(preview) {
  const { permissions, statement } = preview.mandate;
  $('#consent-statement').textContent = statement;
  $('#consent-details').replaceChildren(detailList([
    ['Trust level', trustLabel(permissions.trustLevel)],
    ['Budget', money(permissions.budgetCents)],
    ['Ask for approval above', permissions.approvalCents === 0 ? 'Every purchase' : money(permissions.approvalCents)],
    ['Approval requests expire after', `${permissions.approvalExpiryDays} days`],
    ['Connection expires', utcDay(permissions.connectionExpiresAt)],
  ]));
}

function endConnect() {
  connectFlow = null;
  showTab('agents');
}

async function cancelConnect() {
  if (connectFlow && connectFlow.stage !== 'stepup') {
    try {
      await post('/api/connections/cancel', { challengeId: connectFlow.challengeId });
    } catch { /* The step-up may have lapsed, and there is nothing else to undo. */ }
  }
  endConnect();
}

function renderRules() {
  const { credit } = state;
  $('#credit-summary').replaceChildren(detailList([
    ['Credit limit', money(credit.creditLimitCents)],
    ['Current balance', money(credit.balanceCents)],
    ['Available credit', money(credit.availableCents)],
  ]));
  $('#budget').max = (credit.availableCents / 100).toFixed(2);

  const serialized = JSON.stringify([state.rules, state.agentShares]);
  if (formDirty || serialized === renderedRules) return;
  renderedRules = serialized;
  $('#agent-shares').replaceChildren(...state.demoAgents.map((agent) => {
    const label = el('label', 'share-field');
    const input = el('input');
    input.type = 'number';
    input.inputMode = 'decimal';
    input.min = '0';
    input.step = '0.01';
    input.dataset.agentShare = agent.id;
    const share = state.agentShares[agent.id];
    if (share !== undefined) input.value = (share / 100).toFixed(2);
    const box = el('span', 'money-input');
    box.append(el('span', '', '$'), input);
    const name = el('span', 'merchant');
    name.append(image('logo', agent.icon), el('span', '', agent.shortName));
    label.append(name, box);
    return label;
  }));
  $('#budget').value = (state.rules.budgetCents / 100).toFixed(2);
  $('#approval').value = (state.rules.approvalCents / 100).toFixed(2);
}

function renderShopAgents() {
  const active = activeConnections();
  if (!active.some((c) => c.id === selectedAgentId)) selectedAgentId = active[0]?.id ?? null;
  const chips = $('#agent-chips');
  chips.hidden = active.length < 2;
  chips.replaceChildren(...active.map((connection) => {
    const chip = button('chip-agent', '', () => { selectedAgentId = connection.id; render(); });
    chip.dataset.connection = connection.id;
    chip.setAttribute('aria-pressed', String(connection.id === selectedAgentId));
    chip.disabled = state.agent.running;
    chip.append(image('', connection.icon), el('span', '', connection.shortName));
    return chip;
  }));
  return active.length > 0;
}

function renderAgent() {
  const hasAgent = renderShopAgents();
  const ahead = state.simulatedDays;
  $('#sim-day').textContent = ahead
    ? `Simulated time is ${ahead} ${ahead === 1 ? 'day' : 'days'} ahead.`
    : 'A pending approval lasts 3 days. Simulated time is on today.';
  $('#connect-first').hidden = hasAgent || state.connections.some((c) => c.status === 'active');
  $('#send-section').hidden = !hasAgent;
  $('#agent-status').textContent = state.agent.running ? '' : state.agent.message;
  $('#agent-status').hidden = state.agent.running;
  $('#run-agent').disabled = state.agent.running || state.paused;
  $('#simulate-overreach').disabled = state.agent.running || !hasAgent;
  $('#simulate-injection').disabled = state.agent.running || !hasAgent;
  $('#run-agent').textContent = state.agent.running ? 'Agent is shopping…' : 'Review the plan';
  const shown = activityAgentId ? state.purchases.filter((p) => p.agentId === activityAgentId) : state.purchases;
  $('#activity-filter').replaceChildren(agentFilter(state.purchases, state.demoAgents, activityAgentId, (id) => { activityAgentId = id; render(); }));
  $('#purchases').replaceChildren(shown.length ? transactionList(shown, { money, day, onOpen: openPurchase }) : el('p', 'empty', 'No purchases yet.'));
}

function renderApprovals() {
  const pending = state.purchases.filter((purchase) => purchase.status === 'pending');
  $('#approvals').replaceChildren(pending.length ? approvalRows(pending, { money, onOpen: openApproval }) : allClear());
  const badge = $('#approval-badge');
  badge.hidden = pending.length === 0;
  badge.textContent = pending.length;

  const fresh = pending.find((purchase) => !seenPending.has(purchase.id));
  pending.forEach((purchase) => seenPending.add(purchase.id));
  if (fresh && !UNINTERRUPTED_TABS.includes(currentTab) && !sheetPurchaseId) openApproval(fresh.id);
  renderApprovalSheet();
}

function renderLog() {
  const entries = [...state.log].reverse();
  const purchasesById = new Map(state.purchases.map((purchase) => [purchase.id, purchase]));
  // Each purchase gets one report button, on its newest entry.
  const withButton = new Set();
  $('#log').replaceChildren(...(entries.length ? entries.map((entry) => {
    const item = el('li', `log-entry ${entry.actor}${entry.flagged ? ' flagged' : ''}`);
    const head = el('div', 'card-row');
    head.append(el('strong', '', entry.flagged ? 'Flagged' : ACTOR_LABELS[entry.actor]), el('time', 'muted', time(entry.at)));
    const body = el('div', 'log-body');
    const purchase = purchasesById.get(entry.purchaseId);
    if (purchase) body.append(image('logo', purchase.merchantLogo, `${purchase.merchantName} logo`));
    body.append(el('p', '', entry.message));
    item.append(head, body);
    if (purchase && !withButton.has(entry.purchaseId)) {
      withButton.add(entry.purchaseId);
      if (wasCharged(purchase)) item.append(button('link details', 'View purchase details', () => openPurchase(purchase.id)));
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
  if (refund.evidence?.length) children.push(el('h3', '', 'Evidence'), trailList(refund.evidence));
  if (!refund.outcome) children.push(...simulateButtons(refund));
  $('#refund-detail').replaceChildren(...children);
}

function render() {
  renderHeader();
  renderHome();
  renderAlert();
  renderReminders();
  renderConnections();
  renderRules();
  renderAgent();
  renderApprovals();
  renderLog();
  renderRefunds();
  renderRefundDetail();
  renderPurchaseDetail();
  renderHistory();
  renderRevoke();
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

function showSignInForm() {
  $('#email-form').hidden = false;
  $('#code-form').hidden = true;
  $('#signin-input').value = '';
}

function showSignedOut(notice) {
  events?.close();
  events = null;
  state = null;
  currentUser = null;
  connectFlow = null;
  revokeFlow = null;
  historyConnectionId = null;
  activityAgentId = null;
  closeApproval();
  formDirty = false;
  renderedRules = '';
  renderedConnections = '';
  seenPending.clear();
  $('#app-view').hidden = true;
  $('#signin-view').hidden = false;
  $('#signin-notice').hidden = !notice;
  $('#signin-notice').textContent = notice ?? '';
  showSignInForm();
}

function startApp(user) {
  currentUser = user;
  $('#signin-view').hidden = true;
  $('#app-view').hidden = false;
  showTab('home');
  events = new EventSource('/api/events');
  events.onopen = () => setLive(true);
  events.onerror = async () => {
    setLive(false);
    const response = await fetch('/api/session').catch(() => null);
    if (response?.status === 401) showSignedOut('Your session expired. Sign in again.');
  };
  events.onmessage = (event) => {
    const firstState = !state;
    state = JSON.parse(event.data);
    if (firstState) buildReportReasons();
    render();
  };
}

function limitsFromForm() {
  return {
    budgetCents: toCents($('#limit-budget').value),
    approvalCents: trustChoice === 'above' ? toCents($('#limit-approval').value) : 0,
    trustLevel: trustChoice,
    connectionExpiresOn: $('#limit-expiry').value,
  };
}

const onSubmit = (selector, handler) => $(selector).addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await handler();
  } catch (error) {
    toast(error.message);
  }
});

const selectedConnection = () => ({ connectionId: selectedAgentId });

document.querySelectorAll('.tabs button').forEach((node) => {
  node.prepend(icon(node.dataset.tab, 22));
  node.addEventListener('click', () => showTab(node.dataset.tab));
});

['#signin-input', '#stepup-input'].forEach((selector) => {
  $(selector).addEventListener('input', (event) => {
    event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6);
    if (event.target.value.length === 6) event.target.form.requestSubmit();
  });
});

$('#connect-first-button').addEventListener('click', () => showTab('agents'));
$('#see-all').addEventListener('click', () => { showTab('activity'); showSegment('purchases'); });

onSubmit('#email-form', async () => {
  const { email, demoCode } = await post('/api/auth/code', { email: $('#email').value });
  signInEmail = email;
  $('#signin-bubble').replaceChildren(codeBubble(demoCode, () => fillCode($('#signin-input'), demoCode)));
  $('#signin-notice').hidden = true;
  $('#email-form').hidden = true;
  $('#code-form').hidden = false;
  $('#signin-input').focus();
});

onSubmit('#code-form', async () => {
  const { user } = await post('/api/auth/verify', { email: signInEmail, code: $('#signin-input').value });
  startApp(user);
});

$('#change-email').addEventListener('click', showSignInForm);

$('#stop-all').addEventListener('click', () => {
  if (state.paused) act('/api/agent/resume', {}, 'Agents resumed.');
  else act('/api/agents/stop-all', {}, 'All agents stopped.');
});

document.querySelectorAll('[data-segment]').forEach((node) => {
  node.addEventListener('click', () => showSegment(node.dataset.segment));
});

async function openPlan() {
  try {
    planConnectionId = selectedAgentId;
    const plan = await post('/api/agent/plan', selectedConnection());
    $('#plan-ask').textContent = `You asked: ${plan.ask}`;
    $('#plan-items').replaceChildren(planList(plan, money));
    const updateTotal = () => {
      const chosen = selectedPlanItems($('#plan-items'));
      $('#plan-total').textContent = planSummary(plan, chosen, money);
      $('#plan-proceed').disabled = chosen.length === 0;
    };
    $('#plan-items').onchange = updateTotal;
    updateTotal();
    showTab('plan');
  } catch (error) {
    toast(error.message);
  }
}

$('#signout-button').addEventListener('click', async () => {
  try {
    await post('/api/auth/signout');
    showSignedOut('You are signed out.');
  } catch (error) {
    toast(error.message);
  }
});

onSubmit('#stepup-form', async () => {
  await post('/api/connections/step-up/verify', { challengeId: connectFlow.challengeId, code: $('#stepup-input').value });
  fillLimitsForm();
  showConnectStage('limits');
});

onSubmit('#limits-form', async () => {
  const permissions = limitsFromForm();
  const preview = await post('/api/connections/preview', { challengeId: connectFlow.challengeId, permissions });
  connectFlow.permissions = permissions;
  renderConsent(preview);
  showConnectStage('consent');
});

$('#consent-allow').addEventListener('click', async () => {
  try {
    await post('/api/connections/allow', { challengeId: connectFlow.challengeId, permissions: connectFlow.permissions });
    const { agent, connection } = connectFlow;
    $('#connect-done').replaceChildren(successPanel(
      connection ? 'Permissions updated' : `${agent.shortName} is connected`,
      'It can only act within the permissions you signed. You can stop it at any time.',
      'Back to Home',
      () => { connectFlow = null; showTab('home'); },
    ));
    showConnectStage('done');
  } catch (error) {
    toast(error.message);
  }
});

$('#consent-cancel').addEventListener('click', cancelConnect);
$('#connect-back').addEventListener('click', cancelConnect);

$('#rules-form').addEventListener('input', () => { formDirty = true; });

$('#purchase-back').addEventListener('click', () => showTab(purchaseReturnTab));

onSubmit('#rules-form', async () => {
  const agentShares = Object.fromEntries([...document.querySelectorAll('input[data-agent-share]')]
    .filter((input) => input.value !== '')
    .map((input) => [input.dataset.agentShare, toCents(input.value)]));
  await post('/api/rules', {
    budgetCents: toCents($('#budget').value),
    approvalCents: toCents($('#approval').value),
    agentShares,
  });
  formDirty = false;
  toast('Rules saved.');
});

$('#run-agent').addEventListener('click', openPlan);
$('#plan-back').addEventListener('click', () => showTab('home'));
$('#plan-myself').addEventListener('click', () => {
  toast('Okay. The agent will not shop this time.');
  showTab('home');
});
$('#plan-proceed').addEventListener('click', () => {
  act('/api/agent/run', { connectionId: planConnectionId, items: selectedPlanItems($('#plan-items')) });
  showTab('home');
});
$('#simulate-overreach').addEventListener('click', () => act('/api/agent/overreach', selectedConnection()));
$('#simulate-injection').addEventListener('click', () => act('/api/agent/injection', selectedConnection()));
$('#agent-back').addEventListener('click', () => showTab('agents'));
$('#simulate-uncleared').addEventListener('click', () => act('/api/simulate/uncleared-charge'));
$('#simulate-next-day').addEventListener('click', () => act('/api/simulate/next-day'));
$('#report-back').addEventListener('click', () => showTab('activity'));
$('#refund-back').addEventListener('click', () => { showTab('activity'); showSegment('refunds'); });

onSubmit('#report-form', async () => {
  const before = state.refunds.length;
  const reason = document.querySelector('input[name="report-reason"]:checked').value;
  const updated = await post(`/api/purchases/${reportPurchaseId}/report`, { reason, note: $('#report-note').value });
  state = updated;
  render();
  toast('Refund request submitted.');
  openRefund(updated.refunds[before].id);
});

$('#reset').addEventListener('click', async () => {
  try {
    formDirty = false;
    renderedRules = '';
    seenPending.clear();
    await post('/api/reset');
    toast('Demo reset. Connected agents were kept.');
    showTab('home');
  } catch (error) {
    toast(error.message);
  }
});

const session = await fetch('/api/session');
if (session.ok) startApp((await session.json()).user);
else showSignedOut();
