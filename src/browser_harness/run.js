#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as admin from './admin.js';
import * as helpers from './helpers.js';
import * as browser_use_agent from '../browser_use/agent.js';
import * as browser_use_dom from '../browser_use/dom.js';
import * as browser_use_controller from '../browser_use/controller.js';
import * as browser_use_views from '../browser_use/views.js';

const HELP = `Browser Harness (Node.js/Bun)

Typical usage:
  browser-harness -c '
  await ensure_real_tab()
  console.log(await page_info())
  '

Helpers are pre-imported. The daemon auto-starts and connects to the running browser.
Commands:
  --version        print version
  --doctor         diagnose state
  --reload         restart daemon
  --update         update package
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(HELP);
    return;
  }

  if (args[0] === '--version') {
    console.log('0.1.0 (nodejs)');
    return;
  }

  if (args[0] === '--doctor') {
    process.exit(await admin.run_doctor());
  }

  if (args[0] === '--reload') {
    await admin.restart_daemon();
    console.log("daemon stopped — will restart fresh on next call");
    return;
  }

  if (args[0] === '--update') {
    process.exit(await admin.run_update());
  }

  if (args[0] === '-c') {
    if (args.length < 2) {
      console.error("Usage: browser-harness -c \"await console.log(await page_info())\"");
      process.exit(1);
    }
    
    await admin.ensure_daemon();
    
    const code = args[1];
    const context = {
      ...helpers,
      ...admin,
      ...browser_use_agent,
      ...browser_use_dom,
      ...browser_use_controller,
      ...browser_use_views,
      console,
      process,
      setTimeout,
      setInterval,
      Buffer,
      JSON,
      URL,
      fetch,
      BigInt,
    };
    
    // Wrap in async IIFE
    const script = new vm.Script(`(async () => { ${code} })()`);
    try {
      await script.runInNewContext(context);
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
    return;
  }

  console.error(`Unknown command: ${args[0]}`);
  process.exit(1);
}

main();
