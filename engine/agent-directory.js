// What an agent signs at checkout, so the merchant can tell who is really asking.
export function checkoutPayload({ purchaseId, merchantId, item, amountCents }) {
  return JSON.stringify([purchaseId, merchantId, item, amountCents]);
}

function demoDigest(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

// A stand-in for a directory of agent keys, for use in the browser only.
// It shows the flow but is not real cryptography. The app uses Ed25519 keys instead.
export function createDemoAgentDirectory() {
  const secrets = new Map();
  const secretFor = (agentId) => {
    if (!secrets.has(agentId)) secrets.set(agentId, globalThis.crypto.randomUUID());
    return secrets.get(agentId);
  };
  return {
    sign: (agentId, payload) => demoDigest(`${secretFor(agentId)}:${payload}`),
    verify: (agentId, payload, signature) => typeof signature === 'string'
      && signature === demoDigest(`${secretFor(agentId)}:${payload}`),
  };
}
