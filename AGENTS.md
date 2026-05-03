browser-harness is a thin layer that connects agents to browsers via an editable CDP harness.

# Code priorities
- Clarity
- Precision
- Low verbosity
- Versatility

# Overview
Core code lives in `src/browser_harness/`:
- `admin.js` — daemon lifecycle, diagnostics, updates, profile management
- `daemon.js` — the long-lived middleman process between the browser and the agent
- `helpers.js` — CDP wrapper and core browser primitives auto-imported into `-c` scripts
- `run.js` — the `browser-harness` CLI

`SKILL.md` tells agents how to use the harness and CLI.
`install.md` tells agents how to install it, attach a browser, and troubleshoot.

An agent operating the harness only edits inside `agent-workspace/`:
- `agent_helpers.js` — task-specific browser helpers the agent adds
- `domain-skills/` — skills the agent writes and reads

# Contributing
Consider what is really needed. Prefer the smallest diff that fixes the bug.

**Legacy Skills**: If you find Python code in `domain-skills/`, refactor it to `await`-based Javascript immediately.
