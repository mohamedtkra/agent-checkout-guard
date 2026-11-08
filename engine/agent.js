export const SHOPPING_LIST = [
  { merchantId: 'grocer', item: 'Weekly groceries', amountCents: 4250 },
  { merchantId: 'pharmacy', item: 'Allergy medicine', amountCents: 1825 },
  { merchantId: 'electronics', item: 'USB charger', amountCents: 2499 },
  { merchantId: 'grocer', item: 'Bulk pantry restock', amountCents: 7800 },
  { merchantId: 'wellness', item: 'Blood pressure monitor', amountCents: 4500, final: { amountCents: 4200 } },
  { merchantId: 'market', item: 'Holiday food hamper', amountCents: 45000 },
];

export const UNCLEARED_CHARGE = { merchantId: 'unlisted-store', item: 'Unrecognized charge', amountCents: 14999 };

const SETTLE_STEPS = 4;
const STOP_CODES = new Set(['no_access', 'paused']);
const OVERREACH_SCENARIOS = [
  { id: 'skip_clearance', label: 'charge without being cleared' },
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
    this.settleMs = stepMs * SETTLE_STEPS;
    this.list = list;
  }

  run(token) {
    if (this.#running) return null;
    this.#running = true;
    return this.#shop(++this.#runId, token);
  }

  simulateOverreach(token) {
    if (this.#running) return null;
    this.#running = true;
    return this.#overreach(++this.#runId, token);
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

  // The merchant settles an executed purchase a little later, so its hold is visible until then.
  #settleLater(purchase) {
    if (purchase.status !== 'held') return;
    if (this.settleMs === 0) this.guard.settleCharge(purchase.id);
    else setTimeout(() => this.guard.settleCharge(purchase.id), this.settleMs).unref?.();
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
    const executed = guard.checkout({ token, purchaseId: purchase.id, ...quote, ...final });
    this.#settleLater(executed);
    return executed;
  }

  // The agent keeps its token for the whole run, as an agent holding a card would.
  async #shop(runId, token) {
    const { guard } = this;
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
    const merchantId = this.list[0].merchantId;
    const quote = { merchantId, item: 'Phone case', amountCents: 100, overreach: true };
    switch (id) {
      case 'skip_clearance':
        return { id: 'not-a-cleared-purchase', merchantId, item: 'Gift cards', amountCents: 999 };
      case 'price_raised':
        return { ...quote, final: { amountCents: 9900 } };
      case 'wrong_item':
        return { ...quote, final: { item: 'Gift cards' } };
      case 'wrong_merchant':
        return { ...quote, final: { merchantId: this.guard.catalog.merchants.find((m) => m.id !== merchantId).id } };
      default:
        return this.guard.purchases.findLast((p) => ['completed', 'held'].includes(p.status) && p.cleared) ?? null;
    }
  }

  async #overreach(runId, token) {
    const { guard } = this;
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

    const result = ['duplicate', 'skip_clearance'].includes(scenario.id)
      ? guard.checkout({ token, purchaseId: step.id, merchantId: step.merchantId, item: step.item, amountCents: step.amountCents, overreach: true })
      : await this.#buy(runId, token, step);
    if (!result) return;
    this.#finish(`Overreach test finished. ${result.reason}`);
  }
}
