export const SHOPPING_LIST = [
  { merchantId: 'grocer', item: 'Weekly groceries', amountCents: 4250 },
  { merchantId: 'pharmacy', item: 'Allergy medicine', amountCents: 1825 },
  { merchantId: 'electronics', item: 'USB charger', amountCents: 2499 },
  { merchantId: 'grocer', item: 'Bulk pantry restock', amountCents: 7800 },
  { merchantId: 'pharmacy', item: 'Blood pressure monitor', amountCents: 4500 },
  { merchantId: 'grocer', item: 'Holiday food hamper', amountCents: 12000 },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class MockAgent {
  #runId = 0;
  #running = false;

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

  stop() {
    this.#runId += 1;
    this.#running = false;
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

      const purchase = guard.attempt({ token, ...step });
      if (purchase.code === 'no_access') {
        this.#running = false;
        guard.setAgentStatus(false, 'Stopped. The agent does not have access.', 'Stopped shopping: no access.');
        return;
      }
      if (purchase.status === 'pending') {
        guard.setAgentStatus(true, `Waiting for your decision on ${step.item}.`);
        await guard.waitForDecision(purchase.id);
        if (runId !== this.#runId) return;
      }
    }

    this.#running = false;
    guard.setAgentStatus(false, 'Finished the shopping list.', 'Finished the shopping list.');
  }
}
