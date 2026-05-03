import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const IS_WINDOWS = process.platform === 'win32';
const BH_TMP_DIR = process.env.BH_TMP_DIR;
export const _TMP = path.resolve(BH_TMP_DIR || (IS_WINDOWS ? os.tmpdir() : '/tmp'));

if (!fs.existsSync(_TMP)) {
  fs.mkdirSync(_TMP, { recursive: true });
}

const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

let _server_token = null;

function _check(name) {
  if (!NAME_RE.test(name || '')) {
    throw new Error(`invalid BU_NAME ${name}: must match [A-Za-z0-9_-]{1,64}`);
  }
  return name;
}

function _stem(name) {
  _check(name);
  return BH_TMP_DIR ? 'bu' : `bu-${name}`;
}

export const log_path = (name) => path.join(_TMP, `${_stem(name)}.log`);
export const pid_path = (name) => path.join(_TMP, `${_stem(name)}.pid`);
export const port_path = (name) => path.join(_TMP, `${_stem(name)}.port`);
const _sock_path = (name) => path.join(_TMP, `${_stem(name)}.sock`);

function _read_port_file(name) {
  try {
    const d = JSON.parse(fs.readFileSync(port_path(name), 'utf8'));
    return [parseInt(d.port), d.token];
  } catch (e) {
    return [null, null];
  }
}

export function sock_addr(name) {
  if (!IS_WINDOWS) return _sock_path(name);
  const [port] = _read_port_file(name);
  return port ? `127.0.0.1:${port}` : `tcp:${_stem(name)}`;
}

export function spawn_kwargs() {
  if (IS_WINDOWS) {
    return {
      detached: true,
      windowsHide: true,
      stdio: 'ignore'
    };
  }
  return {
    detached: true,
    stdio: 'ignore'
  };
}

export async function connect(name, timeout = 1.0) {
  return new Promise((resolve, reject) => {
    let s;
    let token = null;

    if (!IS_WINDOWS) {
      s = net.connect(_sock_path(name));
    } else {
      const [port, t] = _read_port_file(name);
      if (port === null) {
        return reject(new Error(`Port file not found: ${port_path(name)}`));
      }
      s = net.connect(port, '127.0.0.1');
      token = t;
    }

    s.setTimeout(timeout * 1000);
    s.on('connect', () => resolve([s, token]));
    s.on('error', (e) => reject(e));
    s.on('timeout', () => {
      s.destroy();
      reject(new Error('connection timeout'));
    });
  });
}

export async function request(s, token, req) {
  return new Promise((resolve, reject) => {
    if (token) req = { ...req, token };
    s.write(JSON.stringify(req) + '\n');

    let buffer = '';
    s.on('data', (chunk) => {
      buffer += chunk.toString();
      if (buffer.endsWith('\n')) {
        try {
          resolve(JSON.parse(buffer));
        } catch (e) {
          reject(e);
        }
      }
    });
    s.on('end', () => {
      if (!buffer.endsWith('\n')) {
        resolve({});
      }
    });
    s.on('error', (e) => reject(e));
  });
}

export async function ping(name, timeout = 1.0) {
  let s;
  try {
    const [sock, token] = await connect(name, timeout);
    s = sock;
    const resp = await request(s, token, { meta: 'ping' });
    return resp.pong === true;
  } catch (e) {
    return false;
  } finally {
    if (s) s.destroy();
  }
}

export async function serve(name, handler) {
  if (!IS_WINDOWS) {
    const path_ = _sock_path(name);
    if (fs.existsSync(path_)) fs.unlinkSync(path_);
    const server = net.createServer((socket) => {
      const reader = {
        readline: async () => {
          return new Promise((resolve) => {
            let buffer = '';
            socket.on('data', function onData(chunk) {
              buffer += chunk.toString();
              if (buffer.includes('\n')) {
                const line = buffer.split('\n')[0];
                socket.removeListener('data', onData);
                resolve(line);
              }
            });
            socket.on('end', () => resolve(null));
          });
        }
      };
      const writer = {
        write: (data) => socket.write(data),
        drain: () => new Promise((resolve) => {
          if (!socket.write('')) resolve();
          else socket.once('drain', resolve);
        })
      };
      handler(reader, writer, socket);
    });

    return new Promise((resolve, reject) => {
      server.listen(path_, () => {
        fs.chmodSync(path_, 0o600);
        _server_token = null;
        resolve(server);
      });
      server.on('error', reject);
    });
  } else {
    const server = net.createServer((socket) => {
      const reader = {
        readline: async () => {
          return new Promise((resolve) => {
            let buffer = '';
            socket.on('data', function onData(chunk) {
              buffer += chunk.toString();
              if (buffer.includes('\n')) {
                const line = buffer.split('\n')[0];
                socket.removeListener('data', onData);
                resolve(line);
              }
            });
            socket.on('end', () => resolve(null));
          });
        }
      };
      const writer = {
        write: (data) => socket.write(data),
        drain: () => new Promise((resolve) => {
          if (!socket.write('')) resolve();
          else socket.once('drain', resolve);
        })
      };
      handler(reader, writer, socket);
    });

    return new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        _server_token = crypto.randomBytes(32).toString('hex');
        const pf = port_path(name);
        const tmp = pf + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ port, token: _server_token }));
        fs.renameSync(tmp, pf);
        resolve(server);
      });
      server.on('error', reject);
    });
  }
}

export function expected_token() {
  return _server_token;
}

export function cleanup_endpoint(name) {
  const p = IS_WINDOWS ? port_path(name) : _sock_path(name);
  try {
    fs.unlinkSync(p);
  } catch (e) {}
}
