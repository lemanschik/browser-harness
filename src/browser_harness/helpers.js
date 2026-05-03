import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ipc from './ipc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const AGENT_WORKSPACE = path.resolve(process.env.BH_AGENT_WORKSPACE || path.join(REPO_ROOT, 'agent-workspace'));

let _browser = null;
let _page = null;

async function get_connection() {
  if (_browser && _page) return { browser: _browser, page: _page };
  
  const name = process.env.BU_NAME || 'default';
  const [s, token] = await ipc.connect(name, 5.0);
  const resp = await ipc.request(s, token, { meta: 'connection_status' });
  s.destroy();

  if (!resp.wsUrl) throw new Error("No wsUrl from daemon");

  _browser = await puppeteer.connect({
    browserWSEndpoint: resp.wsUrl,
    defaultViewport: null
  });

  const pages = await _browser.pages();
  _page = pages.find(p => !p.url().startsWith('chrome-extension://')) || pages[0];
  
  return { browser: _browser, page: _page };
}

export async function cdp(method, params = {}) {
  const { page } = await get_connection();
  const client = await page.target().createCDPSession();
  const res = await client.send(method, params);
  await client.detach();
  return res;
}

export async function js(code) {
  const { page } = await get_connection();
  return await page.evaluate(code);
}

export async function goto_url(url) {
  const { page } = await get_connection();
  await page.goto(url, { waitUntil: 'load' });
}

export async function click_at_xy(x, y) {
  const { page } = await get_connection();
  await page.mouse.click(x, y);
}

export async function type_text(text) {
  const { page } = await get_connection();
  await page.keyboard.type(text);
}

export async function capture_screenshot(savePath = null, options = {}) {
  const { page } = await get_connection();
  const buf = await page.screenshot({
    fullPage: options.full || false,
    type: 'png'
  });
  if (savePath) {
    fs.writeFileSync(savePath, buf);
    return savePath;
  }
  return buf.toString('base64');
}

export async function new_tab(url = "about:blank") {
  const { browser } = await get_connection();
  _page = await browser.newPage();
  if (url) await _page.goto(url);
  return _page.target()._targetId;
}

export async function switch_tab(targetId) {
  const { browser } = await get_connection();
  const targets = await browser.targets();
  const target = targets.find(t => t._targetId === targetId);
  if (target) {
    _page = await target.page();
    await _page.bringToFront();
  }
}

export async function close_tab() {
  if (_page) {
    await _page.close();
    const { browser } = await get_connection();
    const pages = await browser.pages();
    _page = pages[0];
  }
}

export async function list_tabs() {
  const { browser } = await get_connection();
  const pages = await browser.pages();
  return pages.map(p => ({
    id: p.target()._targetId,
    url: p.url(),
    title: p.title()
  }));
}

export async function page_info() {
  const { page } = await get_connection();
  const url = page.url();
  const title = await page.title();
  const viewport = await page.viewport() || { width: 0, height: 0 };
  
  return {
    url,
    title,
    viewport: {
      w: viewport.width,
      h: viewport.height
    }
  };
}

export async function wait_for_load(timeout = 30000) {
  const { page } = await get_connection();
  try {
    await page.waitForNavigation({ waitUntil: 'load', timeout });
  } catch (e) {
    // Already loaded or timeout
  }
}

export async function ensure_real_tab() {
  const { browser } = await get_connection();
  const pages = await browser.pages();
  const real = pages.find(p => !p.url().startsWith('chrome://') && !p.url().startsWith('about:'));
  if (real) {
    _page = real;
    await _page.bringToFront();
  } else {
    _page = await browser.newPage();
  }
  return _page;
}
