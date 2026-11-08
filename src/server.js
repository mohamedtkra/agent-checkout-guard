import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MockAgent, UNCLEARED_CHARGE } from './agent.js';
import { ASSET_PATHS } from './catalog.js';
import { Guard, GuardError } from './guard.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT ?? 4321);
const MAX_BODY_BYTES = 10_000;
const APPROVAL_CHECK_MS = 60_000;

const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  ...Object.fromEntries(ASSET_PATHS.map((path) => [path, [path.slice(1), 'image/svg+xml']])),
};

const guard = new Guard();
const agent = new MockAgent(guard);

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY_BYTES) throw new GuardError('Request is too large.', 413);
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new GuardError('Request is not valid JSON.');
  }
}

function assertSameOrigin(req) {
  const { origin, host } = req.headers;
  if (origin && new URL(origin).host !== host) throw new GuardError('Cross-origin request refused.', 403);
}

function streamEvents(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  const send = (state) => res.write(`data: ${JSON.stringify(state)}\n\n`);
  send(guard.snapshot());
  const unsubscribe = guard.subscribe(send);
  req.on('close', unsubscribe);
}

async function handlePost(req, res, pathname) {
  assertSameOrigin(req);
  const body = await readJson(req);
  const decision = pathname.match(/^\/api\/purchases\/([\w-]+)\/decision$/);
  const report = pathname.match(/^\/api\/purchases\/([\w-]+)\/report$/);
  const refundStep = pathname.match(/^\/api\/refunds\/([\w-]+)\/advance$/);

  if (pathname === '/api/rules') {
    guard.setRules(body);
  } else if (pathname === '/api/access') {
    if (body.active) guard.grantAccess();
    else guard.revokeAccess();
  } else if (pathname === '/api/agent/run') {
    if (!agent.run()) throw new GuardError('The agent is already shopping.', 409);
  } else if (pathname === '/api/agent/overreach') {
    if (!agent.simulateOverreach()) throw new GuardError('The agent is already shopping.', 409);
  } else if (pathname === '/api/agent/resume') {
    guard.resumeAgent();
  } else if (pathname === '/api/simulate/uncleared-charge') {
    guard.recordUnclearedCharge(UNCLEARED_CHARGE);
  } else if (pathname === '/api/simulate/next-day') {
    guard.advanceDay();
  } else if (decision) {
    guard.decide(decision[1], body.approve === true);
  } else if (report) {
    guard.reportProblem(report[1], body);
  } else if (refundStep) {
    guard.advanceRefund(refundStep[1], body.outcome);
  } else if (pathname === '/api/reset') {
    agent.stop();
    guard.reset();
  } else {
    throw new GuardError('Not found.', 404);
  }
  sendJson(res, 200, guard.snapshot());
}

async function handle(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (req.method === 'POST') return handlePost(req, res, pathname);
  if (req.method !== 'GET') throw new GuardError('Method not allowed.', 405);
  if (pathname === '/api/state') return sendJson(res, 200, guard.snapshot());
  if (pathname === '/api/events') return streamEvents(req, res);
  if (pathname === '/favicon.ico') return res.writeHead(204).end();

  const file = STATIC_FILES[pathname];
  if (!file) throw new GuardError('Not found.', 404);
  const content = await readFile(fileURLToPath(new URL(`../public/${file[0]}`, import.meta.url)));
  res.writeHead(200, {
    'Content-Type': file[1],
    'Cache-Control': 'no-cache',
    'Content-Security-Policy': "default-src 'self'",
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(content);
}

setInterval(() => guard.checkApprovals(), APPROVAL_CHECK_MS);

createServer((req, res) => {
  handle(req, res).catch((error) => {
    if (!(error instanceof GuardError)) console.error(error);
    const status = error instanceof GuardError ? error.status : 500;
    sendJson(res, status, { error: error instanceof GuardError ? error.message : 'Something went wrong.' });
  });
}).listen(PORT, HOST, () => {
  console.log(`Agent Checkout Guard is running at http://localhost:${PORT}`);
});
