<img src="https://r2.browser-use.com/github/ajsdlasnnalsgasld.png" alt="Browser Harness" width="100%" />

# browser-harness

Direct browser control via CDP. For task-specific edits, use `agent-workspace/agent_helpers.js`. For setup, install, or connection problems, read install.md.

Domain skills (community-contributed per-site playbooks under `agent-workspace/domain-skills/`) are off by default. Set `BH_DOMAIN_SKILLS=1` to enable them; see the bottom section.

## Usage

```bash
browser-harness -c '
await new_tab("https://docs.browser-use.com")
await wait_for_load()
console.log(await page_info())
'
```

### Agent Mode (browser-use port)

Run an autonomous agent loop using the ported `browser-use` logic and Puppeteer.

```javascript
const { page } = await get_connection();
const agent = new Agent(page, {
  chat: async (history) => {
    // Call your LLM here
    return "click 123"; 
  }
});
await agent.step();
```

### CLI

```bash
browser-harness -c '
// any javascript. helpers pre-imported. daemon auto-starts.
'
```

### Cloud browsers (Browser Use cloud)

Authentication: `BROWSER_USE_API_KEY`.

```bash
browser-harness -c '
await start_remote_daemon("work")                               // default — clean browser, no profile
// await start_remote_daemon("work", { profileName: "my-work" })   // reuse a cloud profile (already logged in)
// await start_remote_daemon("work", { profileId: "<uuid>" })      // same, but by UUID
// await start_remote_daemon("work", { proxyCountryCode: "de", timeout: 120 })   // DE proxy, 2-hour timeout
// await start_remote_daemon("work", { proxyCountryCode: null })   // disable the Browser Use proxy
'

BU_NAME=work browser-harness -c '
await new_tab("https://example.com")
console.log(await page_info())
'
```

## Principles

The harness is **powerful yet thin**.

1. **Puppeteer Powered**: All interactions use the Puppeteer API for maximum reliability.
2. **Raw CDP Access**: Still available via `await cdp()` when Puppeteer isn't enough.
3. **Agentic**: Built-in `Agent` and `DomService` for autonomous operation.
4. **Editable**: Put site-specific logic in `agent-workspace/agent_helpers.js`.

## Browser control flow

- **Navigation**: `await goto_url(url)` or `await search({ query, engine: 'google' })`.
- **Interaction**:
    - `await click_at_xy(x, y)`: Low-level coordinate click.
    - `await click({ index: 123 })`: Targeted click using the smart DOM index.
    - `await type({ index: 123, text: "hello" })`: Targeted input.
- **Observation**:
    - `await page_info()`: Basic metadata.
    - `await dom_service.get_dom_tree()`: Deep, filtered DOM structure for the LLM.
    - `await capture_screenshot()`: Visual state.
- **Tabs**: `await new_tab()`, `await switch_tab(index)`, `await list_tabs()`.

## Agent Actions (JSON format)

The `Agent` loop expects actions in this format:

```json
[
  { "name": "click", "params": { "index": 42 } },
  { "name": "type", "params": { "index": 45, "text": "Puppeteer is great" } },
  { "name": "scroll", "params": { "direction": "down", "amount": 1 } }
]
```

## Refactoring Legacy Skills

This repository has transitioned from Python to Node.js/Bun. Many community-contributed skills under `agent-workspace/domain-skills/` still contain Python code blocks.

**If you encounter a legacy skill:**
1. **Refactor on-the-fly**: Convert the Python code blocks to Javascript.
2. **Use `await`**: All helper functions (e.g., `goto_url`, `click_at_xy`, `js`, `page_info`) are now asynchronous.
3. **Update output**: Change `print()` to `console.log()`.
4. **Overwrite**: Save the updated Javascript version back to the original `.md` file.

## Implementation guidelines

- **ESM** for all JS.
- **Puppeteer** is the primary interaction layer for reliability.
- **Agentic**: Leverage `Agent` and `DomService` for complex autonomous tasks.
- **Zero-manager** design for the core; session state is managed by the agent/caller.
- **Avoid heavy dependencies** other than `puppeteer-core`.
- `run.js` stays tiny.

## Gotchas (field-tested)

- **Headless mode is easily detected.** Use a real browser window or a high-quality stealth cloud browser.
- **Coordinates shift.** Re-read element positions if the viewport size changes or after large layout shifts.
- **CDP sessions can break.** The daemon handles re-attachment, but you may need to retry your last command if it fails with a session error.

## Domain skills

Set `BH_DOMAIN_SKILLS=1` to enable per-site playbooks under `agent-workspace/domain-skills/`. `goto_url()` will automatically look for a matching domain folder and append the `.md` files found there to the `page_info()` output.
