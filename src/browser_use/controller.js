export class Controller {
  constructor() {
    this.registry = new Map();
    this.setup_standard_actions();
  }

  setup_standard_actions() {
    // Navigation
    this.register('search', async (page, { query, engine = 'google' }) => {
      const q = encodeURIComponent(query);
      const urls = {
        google: `https://www.google.com/search?q=${q}`,
        duckduckgo: `https://duckduckgo.com/?q=${q}`,
        bing: `https://www.bing.com/search?q=${q}`
      };
      await page.goto(urls[engine] || urls.google, { waitUntil: 'load' });
    });

    this.register('goto', async (page, { url }) => {
      await page.goto(url, { waitUntil: 'load' });
    });

    this.register('go_back', async (page) => {
      await page.goBack();
    });

    this.register('wait', async (page, { seconds }) => {
      await new Promise(r => setTimeout(r, seconds * 1000));
    });

    // Interaction
    this.register('click', async (page, { index, x, y, selector_map }) => {
      if (index !== undefined) {
        const node = selector_map[index];
        if (!node || !node.snapshot_node?.bounds) throw new Error(`Element [${index}] not found`);
        const { x: nx, y: ny, width, height } = node.snapshot_node.bounds;
        await page.mouse.click(nx + width/2, ny + height/2);
      } else if (x !== undefined && y !== undefined) {
        await page.mouse.click(x, y);
      }
    });

    this.register('type', async (page, { index, text, clear = true, selector_map }) => {
      const node = selector_map[index];
      if (!node || !node.snapshot_node?.bounds) throw new Error(`Element [${index}] not found`);
      const { x, y, width, height } = node.snapshot_node.bounds;
      await page.mouse.click(x + width/2, y + height/2);
      if (clear) {
        await page.keyboard.down('Control');
        await page.keyboard.press('a');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
      }
      await page.keyboard.type(text);
    });

    this.register('scroll', async (page, { direction, amount = 1 }) => {
      const distance = amount * 500;
      if (direction === 'down') await page.evaluate(d => window.scrollBy(0, d), distance);
      else if (direction === 'up') await page.evaluate(d => window.scrollBy(0, -d), distance);
    });

    this.register('hover', async (page, { index, selector_map }) => {
      const node = selector_map[index];
      if (!node || !node.snapshot_node?.bounds) throw new Error(`Element [${index}] not found`);
      const { x, y, width, height } = node.snapshot_node.bounds;
      await page.mouse.move(x + width/2, y + height/2);
    });

    // Tabs
    this.register('switch_tab', async (page, { index }) => {
      const browser = page.browser();
      const pages = await browser.pages();
      if (index >= 0 && index < pages.length) {
        await pages[index].bringToFront();
      }
    });

    this.register('close_tab', async (page) => {
      await page.close();
    });

    // Advanced
    this.register('get_dropdown_options', async (page, { index, selector_map }) => {
      const node = selector_map[index];
      if (!node) throw new Error(`Element [${index}] not found`);
      // In a real implementation, we would extract options from the DOM tree
      return node.attributes?.options || []; 
    });

    this.register('upload_file', async (page, { index, filePath, selector_map }) => {
      const node = selector_map[index];
      if (!node) throw new Error(`Element [${index}] not found`);
      // Puppeteer file upload requires the element handle
      const element = await page.$(`[data-backend-node-id="${node.backend_node_id}"]`);
      if (element) await element.uploadFile(filePath);
    });

    this.register('screenshot', async (page, { full = false }) => {
      return await page.screenshot({ fullPage: full, encoding: 'base64' });
    });
  }

  register(name, fn) {
    this.registry.set(name, fn);
  }

  async execute(name, page, params) {
    const fn = this.registry.get(name);
    if (!fn) throw new Error(`Action ${name} not found`);
    return await fn(page, params);
  }
}
