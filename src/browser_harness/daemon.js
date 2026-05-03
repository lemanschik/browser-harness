import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { env } from 'node:process';
import { fileURLToPath } from 'node:url';
import * as ipc from './ipc.js';

function loadEnv() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname, '../../..');
  const workspace = path.resolve(process.env.BH_AGENT_WORKSPACE || path.join(repoRoot, 'agent-workspace'));
  
  const loadFile = (p) => {
    if (!fs.existsSync(p)) return;
    const content = fs.readFileSync(p, 'utf8');
    for (let line of content.split('\n')) {
      line = line.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const [k, v] = line.split('=', 2);
      const key = k.trim();
      const val = v.trim().replace(/^['"]|['"]$/g, '');
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  };

  loadFile(path.join(repoRoot, '.env'));
  loadFile(path.join(workspace, '.env'));
}

loadEnv();

const NAME = process.env.BU_NAME || 'default';
const SOCK = ipc.sock_addr(NAME);
const LOG = ipc.log_path(NAME);
const PID = ipc.pid_path(NAME);
const BUF_LIMIT = 500;

const home = os.homedir();
const PROFILES = [
  path.join(home, 'Library/Application Support/Google/Chrome'),
  path.join(home, 'Library/Application Support/Comet'),
  path.join(home, 'Library/Application Support/Arc/User Data'),
  path.join(home, 'Library/Application Support/Dia/User Data'),
  path.join(home, 'Library/Application Support/Microsoft Edge'),
  path.join(home, 'Library/Application Support/Microsoft Edge Beta'),
  path.join(home, 'Library/Application Support/Microsoft Edge Dev'),
  path.join(home, 'Library/Application Support/Microsoft Edge Canary'),
  path.join(home, 'Library/Application Support/BraveSoftware/Brave-Browser'),
  path.join(home, '.config/google-chrome'),
  path.join(home, '.config/chromium'),
  path.join(home, '.config/chromium-browser'),
  path.join(home, '.config/microsoft-edge'),
  path.join(home, '.config/microsoft-edge-beta'),
  path.join(home, '.config/microsoft-edge-dev'),
  path.join(home, '.var/app/org.chromium.Chromium/config/chromium'),
  path.join(home, '.var/app/com.google.Chrome/config/google-chrome'),
  path.join(home, '.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser'),
  path.join(home, '.var/app/com.microsoft.Edge/config/microsoft-edge'),
  path.join(home, 'AppData/Local/Google/Chrome/User Data'),
  path.join(home, 'AppData/Local/Chromium/User Data'),
  path.join(home, 'AppData/Local/Microsoft/Edge/User Data'),
  path.join(home, 'AppData/Local/Microsoft/Edge Beta/User Data'),
  path.join(home, 'AppData/Local/Microsoft/Edge Dev/User Data'),
  path.join(home, 'AppData/Local/Microsoft/Edge SxS/User Data'),
];

const INTERNAL = ["chrome://", "chrome-untrusted://", "devtools://", "chrome-extension://", "about:"];
const BU_API = "https://api.browser-use.com/api/v3";
const REMOTE_ID = process.env.BU_BROWSER_ID;
const API_KEY = process.env.BROWSER_USE_API_KEY;

function log(msg) {
  fs.appendFileSync(LOG, `${msg}\n`);
}

async function getWsUrl() {
  if (process.env.BU_CDP_WS) return process.env.BU_CDP_WS;
  const cdpUrl = process.env.BU_CDP_URL;
  if (cdpUrl) {
    const deadline = Date.now() + 30000;
    let lastErr = null;
    while (Date.now() < deadline) {
      try {
        const resp = await fetch(`${cdpUrl}/json/version`).then(r => r.json());
        return resp.webSocketDebuggerUrl;
      } catch (e) {
        lastErr = e;
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    throw new Error(`BU_CDP_URL=${cdpUrl} unreachable after 30s: ${lastErr}`);
  }

  for (const base of PROFILES) {
    const portFile = path.join(base, 'DevToolsActivePort');
    if (!fs.existsSync(portFile)) continue;
    try {
      const content = fs.readFileSync(portFile, 'utf8').split('\n');
      const port = content[0]?.trim();
      const wsPath = content[1]?.trim();
      if (!port) continue;

      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        try {
          const resp = await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json());
          return resp.webSocketDebuggerUrl;
        } catch (e) {
          // Handle Chrome 147+ lockdown
          if (wsPath) return `ws://127.0.0.1:${port}${wsPath}`;
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    } catch (e) {}
  }

  for (const probePort of [9222, 9223]) {
    try {
      const resp = await fetch(`http://127.0.0.1:${probePort}/json/version`).then(r => r.json());
      return resp.webSocketDebuggerUrl;
    } catch (e) {}
  }

  throw new Error(`DevToolsActivePort not found — enable chrome://inspect/#remote-debugging, or set BU_CDP_WS`);
}

async function stopRemote() {
  if (!REMOTE_ID || !API_KEY) return;
  try {
    await fetch(`${BU_API}/browsers/${REMOTE_ID}`, {
      method: 'PATCH',
      headers: { 'X-Browser-Use-API-Key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' })
    });
    log(`stopped remote browser ${REMOTE_ID}`);
  } catch (e) {
    log(`stop_remote failed (${REMOTE_ID}): ${e}`);
  }
}

function isRealPage(t) {
  return t.type === 'page' && !INTERNAL.some(i => (t.url || '').startsWith(i));
}

class CDPClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.id = 0;
    this.pending = new Map();
    this.eventListeners = [];
  }
  async start() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else resolve(msg.result);
        } else if (msg.method) {
          for (const l of this.eventListeners) l(msg.method, msg.params, msg.sessionId);
        }
      };
      this.ws.onclose = () => {
        for (const { reject } of this.pending.values()) reject(new Error('WebSocket closed'));
        this.pending.clear();
      };
    });
  }
  async send_raw(method, params = {}, sessionId = null) {
    if (!this.ws || this.ws.readyState !== 1) throw new Error('WebSocket not connected');
    const id = ++this.id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }
}

class Daemon {
  constructor() {
    this.cdp = null;
    this.session = null;
    this.targetId = null;
    this.events = [];
    this.dialog = null;
    this.stopEvent = null; // Promise resolve function
  }

  async attachFirstPage() {
    const targets = (await this.cdp.send_raw('Target.getTargets')).targetInfos;
    let pages = targets.filter(isRealPage);
    if (pages.length === 0) {
      const tid = (await this.cdp.send_raw('Target.createTarget', { url: 'about:blank' })).targetId;
      log(`no real pages found, created about:blank (${tid})`);
      pages = [{ targetId: tid, url: 'about:blank', type: 'page' }];
    }
    this.session = (await this.cdp.send_raw('Target.attachToTarget', { targetId: pages[0].targetId, flatten: true })).sessionId;
    this.targetId = pages[0].targetId;
    log(`attached ${this.targetId} session=${this.session}`);

    for (const d of ['Page', 'DOM', 'Runtime', 'Network']) {
      try {
        await this.cdp.send_raw(`${d}.enable`, {}, this.session);
      } catch (e) {
        log(`enable ${d}: ${e}`);
      }
    }
    return pages[0];
  }

  async start() {
    const url = await getWsUrl();
    log(`connecting to ${url}`);
    this.cdp = new CDPClient(url);
    try {
      await this.cdp.start();
    } catch (e) {
      if (process.env.BU_CDP_WS) throw new Error(`CDP WS handshake failed: ${e}`);
      throw new Error(`CDP WS handshake failed: ${e} -- click Allow in Chrome if prompted`);
    }
    await this.attachFirstPage();

    const markJs = "if(!document.title.startsWith('\uD83D\uDFE2'))document.title='\uD83D\uDFE2 '+document.title";
    this.cdp.eventListeners.push(async (method, params, sessionId) => {
      this.events.push({ method, params, sessionId });
      if (this.events.length > BUF_LIMIT) this.events.shift();

      if (method === 'Page.javascriptDialogOpening') this.dialog = params;
      else if (method === 'Page.javascriptDialogClosed') this.dialog = null;
      else if (method === 'Page.loadEventFired' || method === 'Page.domContentEventFired') {
        try {
          await this.cdp.send_raw('Runtime.evaluate', { expression: markJs }, this.session);
        } catch (e) {}
      }
    });
  }

  async handle(req) {
    const expected = ipc.expected_token();
    if (expected !== null && req.token !== expected) return { error: 'unauthorized' };

    const meta = req.meta;
    if (meta === 'ping') return { pong: true };
    if (meta === 'drain_events') {
      const out = [...this.events];
      this.events = [];
      return { events: out };
    }
    if (meta === 'session') return { session_id: this.session };
    if (meta === 'connection_status') {
      if (!this.targetId) return { error: 'not_attached' };
      try {
        const info = (await this.cdp.send_raw('Target.getTargetInfo', { targetId: this.targetId })).targetInfo;
        let page = null;
        if (isRealPage(info)) {
          page = { targetId: info.targetId, title: info.title || '(untitled)', url: info.url || '' };
        }
        return { target_id: this.targetId, session_id: this.session, page };
      } catch (e) {
        return { error: 'cdp_disconnected' };
      }
    }
    if (meta === 'set_session') {
      this.session = req.session_id;
      this.targetId = req.target_id || this.targetId;
      try {
        await this.cdp.send_raw('Page.enable', {}, this.session);
        await this.cdp.send_raw('Runtime.evaluate', { expression: "if(!document.title.startsWith('\uD83D\uDFE2'))document.title='\uD83D\uDFE2 '+document.title" }, this.session);
      } catch (e) {}
      return { session_id: this.session };
    }
    if (meta === 'pending_dialog') return { dialog: this.dialog };
    if (meta === 'shutdown') {
      if (this.stopEvent) this.stopEvent();
      return { ok: true };
    }

    const method = req.method;
    const params = req.params || {};
    const sid = method.startsWith('Target.') ? null : (req.session_id || this.session);
    try {
      const result = await this.cdp.send_raw(method, params, sid);
      return { result };
    } catch (e) {
      const msg = e.message;
      if (msg.includes('Session with given id not found') && sid === this.session && sid) {
        log(`stale session ${sid}, re-attaching`);
        if (await this.attachFirstPage()) {
          const result = await this.cdp.send_raw(method, params, this.session);
          return { result };
        }
      }
      return { error: msg };
    }
  }
}

async function main() {
  const d = new Daemon();
  await d.start();

  const stopPromise = new Promise(resolve => { d.stopEvent = resolve; });

  const server = await ipc.serve(NAME, async (reader, writer) => {
    try {
      const line = await reader.readline();
      if (!line) return;
      const resp = await d.handle(JSON.parse(line));
      writer.write(JSON.stringify(resp) + '\n');
      await writer.drain();
    } catch (e) {
      log(`conn: ${e}`);
      try {
        writer.write(JSON.stringify({ error: String(e) }) + '\n');
        await writer.drain();
      } catch (e2) {}
    }
  });

  log(`listening on ${ipc.sock_addr(NAME)} (name=${NAME}, remote=${REMOTE_ID || 'local'})`);
  
  await stopPromise;
  server.close();
  ipc.cleanup_endpoint(NAME);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (await ipc.ping(NAME)) {
    console.error(`daemon already running on ${SOCK}`);
    process.exit(0);
  }
  fs.writeFileSync(LOG, '');
  fs.writeFileSync(PID, String(process.pid));
  
  try {
    await main();
  } catch (e) {
    log(`fatal: ${e}`);
    process.exit(1);
  } finally {
    await stopRemote();
    try { fs.unlinkSync(PID); } catch (e) {}
  }
}
