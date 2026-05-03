import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as ipc from './ipc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const AGENT_WORKSPACE = path.resolve(process.env.BH_AGENT_WORKSPACE || path.join(REPO_ROOT, 'agent-workspace'));

function loadEnv() {
  const loadFile = (p) => {
    if (!fs.existsSync(p)) return;
    const content = fs.readFileSync(p, 'utf8');
    for (let line of content.split('\n')) {
      line = line.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const [k, v] = line.split('=', 2);
      const key = k.trim();
      const val = v.trim().replace(/^['"]|['"]$/g, '');
      if (process.env[key] === undefined) process.env[key] = val;
    }
  };
  loadFile(path.join(REPO_ROOT, '.env'));
  loadFile(path.join(AGENT_WORKSPACE, '.env'));
}

loadEnv();

export const NAME = process.env.BU_NAME || 'default';
const BU_API = "https://api.browser-use.com/api/v3";
const GH_RELEASES = "https://api.github.com/repos/browser-use/browser-harness/releases/latest";

export async function daemon_alive(name = null) {
  return await ipc.ping(name || NAME, 1.0);
}

function _log_tail(name) {
  try {
    const lines = fs.readFileSync(ipc.log_path(name || NAME), 'utf8').trim().split('\n');
    return lines[lines.length - 1];
  } catch (e) {
    return null;
  }
}

async function _daemon_browser_connection(name) {
  let s, token;
  try {
    [s, token] = await ipc.connect(name, 1.0);
    const resp = await ipc.request(s, token, { meta: 'connection_status' });
    if (resp.error) return null;
    return { name, page: resp.page };
  } catch (e) {
    return null;
  } finally {
    if (s) s.destroy();
  }
}

export async function browser_connections() {
  const suffix = ipc.IS_WINDOWS ? '.port' : '.sock';
  const names = [];
  const files = fs.readdirSync(ipc._TMP);
  for (const f of files) {
    if (f.startsWith('bu-') && f.endsWith(suffix)) {
      names.push(f.slice(3, -suffix.length));
    } else if (f === `bu${suffix}`) {
      names.push(NAME);
    }
  }
  
  const out = [];
  for (const name of names) {
    const conn = await _daemon_browser_connection(name);
    if (conn) out.push(conn);
  }
  return out;
}

export async function ensure_daemon(wait = 60.0, name = null, env_ = null) {
  if (await daemon_alive(name)) {
    try {
      const [s, token] = await ipc.connect(name || NAME, 3.0);
      const resp = await ipc.request(s, token, { method: 'Target.getTargets', params: {} });
      if (resp.result) {
        s.destroy();
        return;
      }
      s.destroy();
    } catch (e) {}
    await restart_daemon(name);
  }

  const e = { ...process.env, BU_NAME: name || NAME, ...env_ };
  const daemonPath = path.join(__dirname, 'daemon.js');
  
  const p = spawn(process.argv[0], [daemonPath], {
    env: e,
    detached: true,
    stdio: 'ignore',
    ...ipc.spawn_kwargs()
  });
  p.unref();

  const deadline = Date.now() + wait * 1000;
  while (Date.now() < deadline) {
    if (await daemon_alive(name)) return;
    await new Promise(r => setTimeout(r, 200));
  }
  const msg = _log_tail(name) || "";
  throw new Error(msg || `daemon ${name || NAME} didn't come up`);
}

export async function restart_daemon(name = null) {
  const n = name || NAME;
  try {
    const [s, token] = await ipc.connect(n, 5.0);
    await ipc.request(s, token, { meta: 'shutdown' });
    s.destroy();
  } catch (e) {}

  const pidPath = ipc.pid_path(n);
  try {
    const pid = parseInt(fs.readFileSync(pidPath, 'utf8'));
    if (pid) {
      for (let i = 0; i < 75; i++) {
        try {
          process.kill(pid, 0);
          await new Promise(r => setTimeout(r, 200));
        } catch (e) {
          break;
        }
        if (i === 70) {
          try { process.kill(pid, 'SIGTERM'); } catch (e) {}
        }
      }
    }
  } catch (e) {}
  
  ipc.cleanup_endpoint(n);
  try { fs.unlinkSync(pidPath); } catch (e) {}
}

export async function run_doctor() {
  const cur = "0.1.0"; // Placeholder
  const chrome = true; // Placeholder logic
  const alive = await daemon_alive();
  const conns = await browser_connections();

  console.log("browser-harness doctor");
  console.log(`  platform          ${process.platform} ${os.release()}`);
  console.log(`  node              ${process.version}`);
  console.log(`  version           ${cur}`);
  console.log(`  chrome running    ${chrome ? 'ok' : 'FAIL'}`);
  console.log(`  daemon alive      ${alive ? 'ok' : 'FAIL'}`);
  console.log(`  active connections ${conns.length}`);
  for (const c of conns) {
    console.log(`        ${c.name} — active page: ${c.page?.title || '(no page)'}`);
  }
  return (chrome && alive) ? 0 : 1;
}

export async function start_remote_daemon(name = "remote", options = {}) {
  // Simplified cloud browser logic
  const key = process.env.BROWSER_USE_API_KEY;
  if (!key) throw new Error("BROWSER_USE_API_KEY missing");
  
  const resp = await fetch(`${BU_API}/browsers`, {
    method: 'POST',
    headers: { 'X-Browser-Use-API-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(options)
  }).then(r => r.json());

  const wsUrl = await fetch(`${resp.cdpUrl}/json/version`).then(r => r.json()).then(j => j.webSocketDebuggerUrl);
  
  await ensure_daemon(60, name, {
    BU_CDP_WS: wsUrl,
    BU_BROWSER_ID: resp.id
  });
  
  console.log(resp.liveUrl);
  return resp;
}

export async function run_update() {
  console.log("Update logic not implemented in JS yet. Use git pull or npm install.");
  return 0;
}
