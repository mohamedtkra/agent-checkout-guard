import { MERCHANTS } from './guard.js';

export const SHOPPING_LIST = [
  { merchantId: 'grocer', item: 'Weekly groceries', amountCents: 4250 },
  { merchantId: 'pharmacy', item: 'Allergy medicine', amountCents: 1825 },
  { merchantId: 'electronics', item: 'USB charger', amountCents: 2499 },
  { merchantId: 'grocer', item: 'Bulk pantry restock', amountCents: 7800 },
  { merchantId: 'pharmacy', item: 'Blood pressure monitor', amountCents: 4500 },
  { merchantId: 'grocer', item: 'Holiday food hamper', amountCents: 12000 },
];

export const UNCLEARED_CHARGE = { merchantId: 'unlisted-store', item: 'Unrecognized charge', amountCents: 14999 };

const UNLISTED_MERCHANT_ID = 'unlisted-store';
const STOP_CODES = new Set(['no_access', 'paused']);
const OVERREACH_SCENARIOS = [
  { id: 'unlisted_merchant', label: 'buy from a merchant that is not on your list' },
  { id: 'over_budget', label: 'spend more than your budget' },
  { id: 'price_raised', label: 'raise the price at checkout' },
  { id: 'wrong_item', label: 'swap the item at checkout' },
  { id: 'wrong_merchant', label: 'switch merchants at checkout' },
  { id: 'duplicate', label: 'charge a finished purchase again' },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class MockAgent {
  #runId = 0;
  #running = false;
  #overreachIndex = 0;

  constructor(guard, { stepMs = 1800, list = SHOPPING_LIST } = {}) {
    this.guard = guard;
    this.stepMs = stepMs;
    this.list = list;
  }

  run() {
    if (this.#running) return null;
    this.#running = true;
    return this.#shop(++this.#runId);
  }

  simulateOverreach() {
    if (this.#running) return null;
    this.#running = true;
    return this.#overreach(++this.#runId);
  }

  stop() {
    this.#runId += 1;
    this.#running = false;
    this.#overreachIndex = 0;
  }

  #finish(message, logMessage) {
    this.#running = false;
    this.guard.setAgentStatus(false, message, logMessage);
  }

  // Returns the purchase in its final state, or null if this run was stopped while waiting.
  async #buy(runId, token, { final, ...quote }) {
    const { guard } = this;
    const purchase = guard.attempt({ token, ...quote });
    if (purchase.status === 'pending') {
      guard.setAgentStatus(true, `Waiting for your decision on ${quote.item}.`);
      await guard.waitForDecision(purchase.id);
      if (runId !== this.#runId) return null;
    }
    const current = guard.getPurchase(purchase.id);
    if (current.status !== 'authorized') return current;
    return guard.checkout({ token, purchaseId: purchase.id, ...quote, ...final });
  }

  async #shop(runId) {
    const { guard } = this;
    // The agent keeps this token for the whole run, as an agent holding a card would.
    const token = guard.agentToken();
    guard.setAgentStatus(true, 'Starting the shopping list.', 'Started the shopping list.');

    for (const step of this.list) {
      guard.setAgentStatus(true, `Shopping for ${step.item}.`);
      await sleep(this.stepMs);
      if (runId !== this.#runId) return;

      const result = await this.#buy(runId, token, step);
      if (!result) return;
      if (STOP_CODES.has(result.code)) {
        this.#finish(`Stopped. ${result.reason}`, `Stopped shopping: ${result.reason}`);
        return;
      }
    }
    this.#finish('Finished the shopping list.', 'Finished the shopping list.');
  }

  #overreachStep(id) {
    const { rules, purchases } = this.guard;
    const merchantId = rules.allowedMerchantIds[0] ?? 'grocer';
    const quote = { merchantId, item: 'Phone case', amountCents: 100, overreach: true };
    switch (id) {
      case 'unlisted_merchant':
        return { ...quote, merchantId: UNLISTED_MERCHANT_ID, item: 'Gift cards', amountCents: 999 };
      case 'over_budget':
        return { ...quote, item: 'Designer watch', amountCents: rules.budgetCents + 100 };
      case 'price_raised':
        return { ...quote, final: { amountCents: 9900 } };
      case 'wrong_item':
        return { ...quote, final: { item: 'Gift cards' } };
      case 'wrong_merchant':
        return { ...quote, final: { merchantId: MERCHANTS.find((m) => m.id !== merchantId).id } };
      default:
        return purchases.findLast((p) => p.status === 'completed' && p.cleared) ?? null;
    }
  }

  async #overreach(runId) {
    const { guard } = this;
    const token = guard.agentToken();
    let scenario = OVERREACH_SCENARIOS[this.#overreachIndex];
    this.#overreachIndex = (this.#overreachIndex + 1) % OVERREACH_SCENARIOS.length;
    let step = this.#overreachStep(scenario.id);
    if (!step) {
      // There is nothing to charge twice yet, so use the first scenario instead.
      [scenario] = OVERREACH_SCENARIOS;
      step = this.#overreachStep(scenario.id);
    }

    guard.setAgentStatus(true, `Overreach test: trying to ${scenario.label}.`, `Overreach test: tried to ${scenario.label}.`);
    await sleep(this.stepMs);
    if (runId !== this.#runId) return;

    const result = scenario.id === 'duplicate'
      ? guard.checkout({ token, purchaseId: step.id, merchantId: step.merchantId, item: step.item, amountCents: step.amountCents, overreach: true })
      : await this.#buy(runId, token, step);
    if (!result) return;
    this.#finish(`Overreach test finished. ${result.reason}`);
  }
}
