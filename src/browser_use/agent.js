import { DomService, DOMTreeSerializer } from './dom.js';
import { Controller } from './controller.js';

export class Agent {
  constructor(page, model, options = {}) {
    this.page = page;
    this.model = model;
    this.controller = new Controller();
    this.history = [];
    this.dom_service = new DomService(page);
    this.max_steps = options.max_steps || 10;
    this.sensitive_data = options.sensitive_data || {};
  }

  async step() {
    // 1. Observe
    const root = await this.dom_service.get_dom_tree();
    const serializer = new DOMTreeSerializer(root);
    const state = serializer.serialize();
    
    const observation = this.format_observation(state);
    const screenshot = await this.page.screenshot({ encoding: 'base64' });

    const userMessage = {
      role: 'user',
      content: [
        { type: 'text', text: `Observation:\n${observation}` },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshot}` } }
      ]
    };

    this.history.push(userMessage);

    // 2. Think & Act
    const response = await this.model.chat(this.history);
    this.history.push({ role: 'assistant', content: response });

    const actions = this.parse_actions(response);
    const results = [];

    for (const action of actions) {
      console.log(`Executing: ${action.name}`, action.params);
      try {
        const result = await this.controller.execute(action.name, this.page, { ...action.params, selector_map: state.selector_map });
        results.push({ name: action.name, status: 'success', result });
      } catch (e) {
        console.error(`Action ${action.name} failed:`, e.message);
        results.push({ name: action.name, status: 'error', error: e.message });
      }
    }

    return results;
  }

  format_observation(state) {
    let output = "Interactive Elements:\n";
    for (const [id, node] of Object.entries(state.selector_map)) {
      const tag = node.tag_name;
      const text = (node.node_value || "").trim().slice(0, 50);
      const label = node.attributes?.['aria-label'] || node.attributes?.title || node.attributes?.placeholder || "";
      output += `[${id}] <${tag}> ${label} ${text}\n`;
    }
    return output;
  }

  parse_actions(text) {
    // Try to find JSON in the response
    try {
      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/({[\s\S]*})/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[1]);
        if (Array.isArray(data)) return data;
        if (data.action) return [data];
        if (data.actions) return data.actions;
      }
    } catch (e) {
      // Fallback to regex if JSON fails
    }

    // Legacy/Regex fallback
    const actions = [];
    const clickMatch = text.match(/click\s+(\d+)/i);
    if (clickMatch) actions.push({ name: 'click', params: { index: parseInt(clickMatch[1]) } });
    
    const gotoMatch = text.match(/goto\s+(https?:\/\/\S+)/i);
    if (gotoMatch) actions.push({ name: 'goto', params: { url: gotoMatch[1] } });

    return actions;
  }

  async run() {
    for (let i = 0; i < this.max_steps; i++) {
      process.stdout.write(`Step ${i+1}/${this.max_steps}... `);
      const results = await this.step();
      if (results.length === 0) {
        console.log("No actions found. Stopping.");
        break;
      }
      if (results.some(r => r.name === 'done')) {
        console.log("Goal achieved.");
        break;
      }
    }
  }
}
