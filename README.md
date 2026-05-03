<img src="https://r2.browser-use.com/github/ajsdlasnnalsgasld.png" alt="Browser Harness" width="100%" />

# Browser Harness ♞

Connect an LLM directly to your real browser with a thin, editable CDP harness. For browser tasks where you need **complete freedom**.

One websocket to Chrome, nothing between. The agent writes what's missing during execution. The harness improves itself every run.

```
  ● agent: wants to upload a file
  │
  ● agent-workspace/agent_helpers.js → helper missing
  │
  ● agent writes it                         agent_helpers.js
  │                                                       + custom helper
  ✓ file uploaded
```

**You will never use the browser again.**

## Setup prompt

Paste into Claude Code or Codex:

```text
Set up https://github.com/browser-use/browser-harness for me.

Read `install.md` and follow the steps to install browser-harness and connect it to my browser.
```

The agent will open `chrome://inspect/#remote-debugging`. Tick the checkbox so the agent can connect to your browser:

<img src="docs/setup-remote-debugging.png" alt="Remote debugging setup" width="520" style="border-radius: 12px;" />

Click Allow when the per-attach popup appears (Chrome 144+):

<img src="docs/allow-remote-debugging.png" alt="Allow remote debugging popup" width="520" style="border-radius: 12px;" />

See [agent-workspace/domain-skills/](agent-workspace/domain-skills/) for example tasks.

## Free Browser Use Cloud browsers

Stealth, sub-agents, or headless deployment.<br>
**Browser Use Cloud free tier: 3 concurrent browsers, proxies, captcha solving, and more. No card required.**

- Grab a key at [cloud.browser-use.com/new-api-key](https://cloud.browser-use.com/new-api-key)
- Or let the agent sign up itself via [docs.browser-use.com/llms.txt](https://docs.browser-use.com/llms.txt) (setup flow + challenge context included).

## Architecture (~2k lines of modern Javascript)

- `src/browser_harness/` — core daemon and connection management
- `src/browser_use/` — **hard-ported browser-use framework** (Agent, DOM, Controller)
- `helpers.js` — **Puppeteer-powered** browser control primitives
- `agent-workspace/agent_helpers.js` — helper code the agent edits
- `agent-workspace/domain-skills/` — reusable site-specific skills the agent edits

## Features

- **Puppeteer Backend**: Reliable interaction via the world's most popular automation library.
- **Autonomous Agent**: Integrated `Agent` loop that observes, thinks, and acts using vision and DOM data.
- **Smart DOM Extraction**: Extracts only interactive and visible elements to minimize LLM context.
- **Action Controller**: High-level actions like `search`, `scroll`, and `upload_file`.
- **Multi-Tab Support**: Manage and switch between multiple browser sessions seamlessly.

---

[The Bitter Lesson of Agent Harnesses](https://browser-use.com/posts/bitter-lesson-agent-harnesses) · [Web Agents That Actually Learn](https://browser-use.com/posts/web-agents-that-actually-learn)
