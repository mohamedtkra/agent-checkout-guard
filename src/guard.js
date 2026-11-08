import { randomBytes, randomUUID } from 'node:crypto';

export const MERCHANTS = [
  { id: 'grocer', name: 'Mock Grocer', category: 'Groceries' },
  { id: 'pharmacy', name: 'Mock Pharmacy', category: 'Health' },
  { id: 'electronics', name: 'Mock Electronics', category: 'Gadgets' },
];

export const DEFAULT_RULES = {
  budgetCents: 20000,
  allowedMerchantIds: ['grocer', 'pharmacy'],
  approvalCents: 5000,
};

export class GuardError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const isCents = (value) => Number.isSafeInteger(value) && value >= 0;
const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const merchantName = (id) => MERCHANTS.find((m) => m.id === id)?.name ?? 'Unknown merchant';

export function rulesError(rules) {
  if (!rules || typeof rules !== 'object') return 'Rules are missing.';
  if (!isCents(rules.budgetCents)) return 'Budget must be a valid amount.';
  if (!isCents(rules.approvalCents)) return 'Approval amount must be a valid amount.';
  const ids = rules.allowedMerchantIds;
  if (!Array.isArray(ids) || !ids.every((id) => MERCHANTS.some((m) => m.id === id))) {
    return 'Allowed merchants must be known merchants.';
  }
  return null;
}

// Anything that cannot be checked is blocked, so a purchase only proceeds on a positive result.
export function evaluate(rules, committedCents, merchantId, amountCents) {
  if (rulesError(rules)) return { outcome: 'block', reason: 'Rules could not be checked.' };
  if (!isCents(committedCents) || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return { outcome: 'block', reason: 'Purchase amount could not be checked.' };
  }
  if (!rules.allowedMerchantIds.includes(merchantId)) {
    return { outcome: 'block', reason: 'Merchant is not on your allowed list.' };
  }
  if (committedCents + amountCents > rules.budgetCents) {
    return { outcome: 'block', reason: 'Purchase would go over your budget.' };
  }
  if (amountCents > rules.approvalCents) {
    return { outcome: 'approval', reason: `Over your ${money(rules.approvalCents)} approval amount.` };
  }
  return { outcome: 'allow', reason: 'Within your rules.' };
}

export class Guard {
  #token = null;
  #waiters = new Map();
  #listeners = new Set();

  constructor() {
    this.#clear();
  }

  #clear() {
    this.rules = structuredClone(DEFAULT_RULES);
    this.purchases = [];
    this.log = [];
    this.agentStatus = { running: false, message: 'Ready to shop.' };
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify() {
    const state = this.snapshot();
    for (const listener of this.#listeners) listener(state);
  }

  #record(actor, message) {
    this.log.push({ id: randomUUID(), at: new Date().toISOString(), actor, message });
  }

  #maskedToken() {
    return this.#token ? `tok_test_••••${this.#token.slice(-4)}` : null;
  }

  #sumCents(statuses, excludeId) {
    return this.purchases
      .filter((p) => statuses.includes(p.status) && p.id !== excludeId)
      .reduce((total, p) => total + p.amountCents, 0);
  }

  #settle(purchase, status, reason) {
    purchase.status = status;
    purchase.reason = reason;
    purchase.settledAt = new Date().toISOString();
    this.#waiters.get(purchase.id)?.();
    this.#waiters.delete(purchase.id);
  }

  #charge(purchase, reason) {
    this.#settle(purchase, 'completed', reason);
    this.#record('payment', `Charged ${money(purchase.amountCents)} to test token ${this.#maskedToken()} at ${purchase.merchantName}. No real money moved.`);
  }

  snapshot() {
    const spentCents = this.#sumCents(['completed']);
    const heldCents = this.#sumCents(['pending']);
    return {
      rules: this.rules,
      merchants: MERCHANTS,
      access: { active: this.#token !== null, token: this.#maskedToken() },
      spentCents,
      heldCents,
      remainingCents: Math.max(0, this.rules.budgetCents - spentCents - heldCents),
      purchases: this.purchases,
      log: this.log,
      agent: this.agentStatus,
    };
  }

  agentToken() {
    return this.#token;
  }

  setRules(rules) {
    const error = rulesError(rules);
    if (error) throw new GuardError(error);
    this.rules = {
      budgetCents: rules.budgetCents,
      allowedMerchantIds: [...new Set(rules.allowedMerchantIds)],
      approvalCents: rules.approvalCents,
    };
    const names = this.rules.allowedMerchantIds.map(merchantName).join(', ') || 'none';
    this.#record('customer', `Set rules: ${money(this.rules.budgetCents)} budget, approval above ${money(this.rules.approvalCents)}, allowed merchants: ${names}.`);
    this.#notify();
  }

  grantAccess() {
    if (this.#token) return;
    this.#token = `tok_test_${randomBytes(8).toString('hex')}`;
    this.#record('customer', `Gave the agent access with test token ${this.#maskedToken()}.`);
    this.#notify();
  }

  revokeAccess() {
    if (!this.#token) return;
    this.#token = null;
    this.#record('customer', 'Revoked the agent\'s access. The test token no longer works.');
    for (const purchase of this.purchases.filter((p) => p.status === 'pending')) {
      this.#settle(purchase, 'canceled', 'Access was revoked before approval.');
      this.#record('guard', `Canceled ${purchase.item} at ${purchase.merchantName}: access was revoked.`);
    }
    this.#notify();
  }

  // Every agent payment passes through here. A stale or missing token never reaches the rules.
  attempt({ token, merchantId, item, amountCents }) {
    const purchase = {
      id: randomUUID(),
      at: new Date().toISOString(),
      merchantId,
      merchantName: merchantName(merchantId),
      item,
      amountCents,
      status: 'pending',
      reason: '',
      code: null,
    };
    this.purchases.push(purchase);
    this.#record('agent', `Tried to buy ${item} for ${money(amountCents)} at ${purchase.merchantName}.`);

    if (!token || token !== this.#token) {
      purchase.code = 'no_access';
      this.#settle(purchase, 'blocked', 'The agent does not have access.');
      this.#record('guard', `Blocked ${item}: the agent does not have access.`);
    } else {
      const committed = this.#sumCents(['completed', 'pending'], purchase.id);
      const { outcome, reason } = evaluate(this.rules, committed, merchantId, amountCents);
      if (outcome === 'block') {
        this.#settle(purchase, 'blocked', reason);
        this.#record('guard', `Blocked ${item}: ${reason}`);
      } else if (outcome === 'approval') {
        purchase.reason = reason;
        this.#record('guard', `Held ${item} for your approval: ${reason}`);
      } else {
        this.#record('guard', `Allowed ${item}: ${reason}`);
        this.#charge(purchase, reason);
      }
    }
    this.#notify();
    return { ...purchase };
  }

  waitForDecision(id) {
    const purchase = this.purchases.find((p) => p.id === id);
    if (purchase?.status !== 'pending') return Promise.resolve();
    return new Promise((resolve) => this.#waiters.set(id, resolve));
  }

  decide(id, approve) {
    const purchase = this.purchases.find((p) => p.id === id);
    if (!purchase) throw new GuardError('Purchase not found.', 404);
    if (purchase.status !== 'pending') throw new GuardError('This purchase has already been decided.', 409);

    if (!approve) {
      this.#settle(purchase, 'denied', 'You denied this purchase.');
      this.#record('customer', `Denied ${purchase.item} at ${purchase.merchantName}.`);
    } else {
      // The rules may have changed while this purchase waited, so check them again.
      const committed = this.#sumCents(['completed', 'pending'], purchase.id);
      const { outcome, reason } = evaluate(this.rules, committed, purchase.merchantId, purchase.amountCents);
      this.#record('customer', `Approved ${purchase.item} at ${purchase.merchantName}.`);
      if (outcome === 'block') {
        this.#settle(purchase, 'blocked', reason);
        this.#record('guard', `Blocked ${purchase.item} after approval: ${reason}`);
      } else {
        this.#charge(purchase, 'You approved this purchase.');
      }
    }
    this.#notify();
    return { ...purchase };
  }

  setAgentStatus(running, message, logMessage) {
    this.agentStatus = { running, message };
    if (logMessage) this.#record('agent', logMessage);
    this.#notify();
  }

  reset() {
    this.#token = null;
    for (const resolve of this.#waiters.values()) resolve();
    this.#waiters.clear();
    this.#clear();
    this.#notify();
  }
}
