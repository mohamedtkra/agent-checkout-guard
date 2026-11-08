import { generateKeyPairSync, sign, verify } from 'node:crypto';

// A mock of a merchant-facing directory of agent keys, modeled on Visa's Trusted Agent Protocol.
// Keys only need to outlive a checkout, so they are generated fresh when the server starts.
export function createAgentDirectory() {
  const keys = new Map();
  const keyFor = (agentId) => {
    if (!keys.has(agentId)) keys.set(agentId, generateKeyPairSync('ed25519'));
    return keys.get(agentId);
  };
  return {
    sign: (agentId, payload) => sign(null, Buffer.from(payload), keyFor(agentId).privateKey).toString('base64'),
    verify: (agentId, payload, signature) => typeof signature === 'string'
      && verify(null, Buffer.from(payload), keyFor(agentId).publicKey, Buffer.from(signature, 'base64')),
  };
}
