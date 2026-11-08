// Screen pieces shared by the app and the Prototype Workbench.

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function image(className, src, alt = '') {
  const node = el('img', className);
  node.src = src;
  node.alt = alt;
  return node;
}

export function button(className, text, onClick) {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

export const TRUST_LEVELS = [
  { id: 'every_time', label: 'Ask me every time', hint: 'Every purchase waits for your approval.' },
  { id: 'above', label: 'Ask me above an amount', hint: 'Smaller purchases go ahead on their own.' },
  { id: 'routine', label: 'Handle routine purchases', hint: 'Only asks above the limit on your Rules.' },
];

export const trustLabel = (id) => TRUST_LEVELS.find((level) => level.id === id)?.label ?? TRUST_LEVELS[1].label;

export function trustPicker(selected, onChange, levels = TRUST_LEVELS) {
  const wrap = el('div', 'trust-picker');
  wrap.append(...levels.map((level) => {
    const label = el('label', 'check compact');
    const input = el('input');
    input.type = 'radio';
    input.name = 'trust-level';
    input.value = level.id;
    input.checked = level.id === selected;
    input.addEventListener('change', () => onChange(level.id));
    const text = el('span');
    text.append(el('strong', '', level.label), el('span', 'muted', level.hint));
    label.append(input, text);
    return label;
  }));
  return wrap;
}

export function whyLines(purchase) {
  const lines = [];
  if (purchase.ask) lines.push(el('p', 'why', `You asked: ${purchase.ask}`));
  if (purchase.why) lines.push(el('p', 'why', `Why this: ${purchase.why}`));
  return lines;
}

export function trailList(trail) {
  const list = el('ol', 'trail');
  list.append(...trail.map((step) => {
    const item = el('li');
    item.append(el('strong', '', step.label), el('span', 'muted', step.detail));
    return item;
  }));
  return list;
}

export function trailView(purchase) {
  const details = el('details', 'why-trail');
  details.append(el('summary', '', 'Why this happened'), trailList(purchase.trail ?? []));
  return details;
}

// Every item starts ticked. Unticking one takes it out of the agent's run.
export function planList(plan, money) {
  const list = el('ul', 'cards plan-list');
  list.append(...plan.items.map((entry) => {
    const item = el('li', 'card');
    const label = el('label', 'plan-item');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = true;
    input.dataset.planIndex = entry.index;
    const text = el('span', 'plan-text');
    text.append(el('strong', '', entry.item), el('span', 'muted', entry.merchantName));
    if (entry.why) text.append(el('span', 'muted', entry.why));
    label.append(input, image('plan-thumb', entry.image), text, el('span', 'amount', money(entry.amountCents)));
    item.append(label);
    return item;
  }));
  return list;
}

export function selectedPlanItems(root) {
  return [...root.querySelectorAll('input[data-plan-index]:checked')].map((input) => Number(input.dataset.planIndex));
}

const ICONS = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  agents: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9c0-4 3.6-7 8-7s8 3 8 7',
  activity: 'M4 6h16M4 12h16M4 18h10',
  rules: 'M12 3l8 3v6c0 5-3.4 8-8 9-4.600-1-8-4-8-9V6z',
  chevron: 'M9 6l6 6-6 6',
  check: 'M5 13l4 4 10-11',
  back: 'M15 6l-6 6 6 6',
};

export function icon(name, size = 24) {
  const ns = 'http://www.w3.org/2000/svg';
  const node = document.createElementNS(ns, 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('width', size);
  node.setAttribute('height', size);
  node.setAttribute('fill', 'none');
  node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', '2');
  node.setAttribute('stroke-linecap', 'round');
  node.setAttribute('stroke-linejoin', 'round');
  node.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name]);
  node.append(path);
  return node;
}

const STATUS_LABELS = { completed: 'Paid', blocked: 'Blocked', pending: 'Needs approval', authorized: 'Cleared', held: 'On hold', denied: 'Denied', canceled: 'Canceled', refunded: 'Refunded' };

export function statusLabel(purchase) {
  if (purchase.flagged) return 'Flagged';
  if (purchase.code === 'handed_off') return 'Left to you';
  if (purchase.reason.startsWith('Declined at checkout')) return 'Declined';
  return STATUS_LABELS[purchase.status];
}

const statusClass = (purchase) => (purchase.flagged ? 'flag' : purchase.status);

export function statusTag(purchase) {
  return el('span', `tag ${statusClass(purchase)}`, statusLabel(purchase));
}

function logoStack(main, sub) {
  const stack = el('span', 'tx-logo');
  stack.append(image('main', main));
  if (sub) stack.append(image('sub', sub));
  return stack;
}

function row(purchase, end, onOpen, className = 'tx') {
  const node = button(className, '', onOpen);
  const body = el('span', 'tx-body');
  body.append(el('strong', '', purchase.item), el('span', '', purchase.subtitle ?? `${purchase.merchantName} · ${purchase.agentName}`));
  node.append(logoStack(purchase.merchantLogo, purchase.categoryIcon), body, end);
  return node;
}

export function transactionList(purchases, { money, day, onOpen }) {
  const wrap = el('div');
  let current = null;
  let list = null;
  [...purchases].reverse().forEach((purchase) => {
    const label = day(purchase.at);
    if (label !== current) {
      current = label;
      list = el('ul', 'list');
      wrap.append(el('p', 'day-label', label), list);
    }
    const end = el('span', 'tx-end');
    end.append(el('span', 'amount', money(purchase.amountCents)));
    if (purchase.status !== 'completed' || purchase.flagged) end.append(statusTag(purchase));
    const item = el('li');
    item.append(row(purchase, end, () => onOpen(purchase.id)));
    list.append(item);
  });
  return wrap;
}

export function approvalRows(pending, { money, onOpen }) {
  const list = el('ul', 'list');
  list.append(...pending.map((purchase) => {
    const end = el('span', 'tx-end');
    end.append(el('span', 'amount', money(purchase.amountCents)), icon('chevron', 18));
    const item = el('li');
    item.append(row({ ...purchase, subtitle: `${purchase.agentName} is asking · ${purchase.merchantName}` }, end, () => onOpen(purchase.id), 'tx attention'));
    return item;
  }));
  return list;
}

export function allClear() {
  const node = el('div', 'clear-row');
  node.append(icon('check', 20), el('span', '', 'All clear. Nothing needs you right now.'));
  return node;
}

export function factList(rows) {
  const list = el('dl', 'facts');
  rows.filter(([, value]) => value).forEach(([label, value]) => {
    const line = el('div');
    line.append(el('dt', '', label), el('dd', '', value));
    list.append(line);
  });
  return list;
}

export function balanceCard({ label, amount, sub, status, statusOff, spentCents, heldCents, totalCents, money }) {
  const card = el('div', 'hero');
  const top = el('div', 'hero-top');
  top.append(el('span', '', label), el('span', `status-dot${statusOff ? ' off' : ''}`, status));
  card.append(top, el('p', 'hero-amount', amount), el('p', 'hero-sub', sub));
  if (totalCents !== undefined) {
    const track = el('div', 'hero-track');
    [['spent', spentCents], ['held', heldCents]].filter(([, cents]) => cents > 0).forEach(([kind, cents]) => {
      const segment = el('span', kind);
      segment.style.width = `${totalCents ? Math.min(100, (cents / totalCents) * 100) : 0}%`;
      track.append(segment);
    });
    const foot = el('div', 'hero-foot');
    [['Spent', spentCents], ['On hold', heldCents]].forEach(([name, cents]) => {
      const item = el('div');
      item.append(el('span', '', `${name} `), el('strong', '', money(cents)));
      foot.append(item);
    });
    card.append(track, foot);
  }
  return card;
}

export function liveStatus(message) {
  const node = el('div', 'live');
  node.setAttribute('role', 'status');
  node.append(el('span', 'spinner'), el('span', '', message));
  return node;
}

export function approvalSheet(purchase, { money, countdown, warning, onApprove, onDeny, onTakeOver }) {
  const wrap = el('div');
  const head = el('div', 'approve-head');
  const title = el('div');
  title.append(el('p', 'muted small', `${purchase.agentName} wants to buy`), el('p', 'approve-title', purchase.item), el('p', 'approve-amount', money(purchase.amountCents)));
  head.append(image('', purchase.image), title);
  const details = [purchase.color, purchase.size].filter(Boolean).join(' · ');
  wrap.append(head, factList([
    ['Merchant', purchase.merchantName],
    ['Category', purchase.category],
    ['Details', details || purchase.description],
    ['You asked', purchase.ask],
    ['Why this', purchase.why],
    ['Why you are being asked', purchase.reason],
    ['Decide by', countdown],
  ]));
  if (warning) wrap.append(el('p', 'notice-amber', warning));
  const actions = el('div', 'actions');
  actions.append(button('button', 'Deny', onDeny), button('button primary', 'Approve', onApprove));
  wrap.append(actions, button('link center-link', 'Buy it myself', onTakeOver));
  return wrap;
}

export function showSheet(host, content, onDismiss) {
  const panel = el('div', 'sheet');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.append(el('div', 'sheet-grip'), content);
  host.replaceChildren(panel);
  host.hidden = false;
  host.onclick = (event) => { if (event.target === host) onDismiss(); };
}

export function hideSheet(host) {
  host.hidden = true;
  host.replaceChildren();
  host.onclick = null;
}

export function steps(labels, index) {
  const list = el('ol', 'steps');
  list.setAttribute('aria-label', `Step ${index + 1} of ${labels.length}`);
  list.append(...labels.map((label, position) => {
    let state = '';
    if (position < index) state = 'done';
    else if (position === index) state = 'current';
    return el('li', state, label);
  }));
  return list;
}

export function successPanel(title, text, actionLabel, onAction) {
  const wrap = el('div', 'success');
  const mark = el('div', 'success-mark');
  mark.append(icon('check', 32));
  wrap.append(mark, el('h2', '', title), el('p', 'muted', text), button('button primary wide', actionLabel, onAction));
  return wrap;
}

export function codeBubble(code, onFill) {
  const node = button('code-bubble', '', onFill);
  const text = el('span');
  text.append(el('span', 'muted small', 'Demo code, no text is sent'), el('strong', '', code));
  node.append(text, el('span', 'fill', 'Tap to fill'));
  return node;
}

export function receipt(purchase, { money, dateText, rows, actions = [], merchantInfo = null }) {
  const wrap = el('div');
  const head = el('div', 'receipt-head');
  const charged = ['completed', 'refunded', 'held'].includes(purchase.status);
  head.append(
    image('', purchase.merchantLogo),
    el('p', 'approve-title', purchase.merchantName),
    el('p', `receipt-amount${charged ? '' : ' struck'}`, money(purchase.amountCents)),
    el('p', 'muted small', dateText),
    statusTag(purchase),
  );
  const card = el('div', 'card');
  card.append(head);
  const item = el('div', 'receipt-item');
  const name = el('div');
  name.append(el('strong', '', purchase.item), el('p', 'muted small', purchase.description));
  item.append(image('', purchase.image), name);
  card.append(item, factList(rows));
  if (purchase.reason) card.append(el('p', 'receipt-note muted', purchase.reason));
  wrap.append(card);
  if (purchase.trail?.length) {
    const trailCard = el('div', 'card');
    trailCard.append(trailList(purchase.trail));
    wrap.append(el('h3', 'section-title', 'Why this happened'), trailCard);
  }
  if (merchantInfo) wrap.append(el('h3', 'section-title', 'Merchant'), merchantInfo);
  wrap.append(...actions);
  return wrap;
}
