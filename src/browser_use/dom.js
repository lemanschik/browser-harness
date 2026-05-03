import { DOMRect, NodeType, EnhancedAXNode, EnhancedAXProperty, EnhancedSnapshotNode, EnhancedDOMTreeNode, SimplifiedNode, SerializedDOMState } from './views.js';

const REQUIRED_COMPUTED_STYLES = [
  'display', 'visibility', 'opacity', 'overflow', 'overflow-x', 'overflow-y', 'cursor', 'pointer-events', 'position', 'background-color'
];

const DISABLED_ELEMENTS = new Set(['style', 'script', 'head', 'meta', 'link', 'title']);
const SVG_ELEMENTS = new Set(['path', 'rect', 'g', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'use', 'defs', 'clipPath', 'mask', 'pattern', 'image', 'text', 'tspan']);

export class ClickableElementDetector {
  static is_interactive(node) {
    if (node.node_type !== NodeType.ELEMENT_NODE) return false;
    const tag = node.tag_name;
    if (tag === 'html' || tag === 'body') return false;
    if (node.has_js_click_listener) return true;

    if (tag === 'iframe' || tag === 'frame') {
      if (node.snapshot_node?.bounds) {
        const { width, height } = node.snapshot_node.bounds;
        if (width > 100 && height > 100) return true;
      }
    }

    if (tag === 'label') {
      if (node.attributes?.for) return false;
      if (this.has_form_control_descendant(node)) return true;
    }

    if (tag === 'span' && this.has_form_control_descendant(node)) return true;

    const interactive_tags = new Set(['button', 'input', 'select', 'textarea', 'a', 'details', 'summary', 'option', 'optgroup']);
    if (interactive_tags.has(tag)) return true;

    if (node.attributes) {
      const interactive_attrs = ['onclick', 'onmousedown', 'onmouseup', 'onkeydown', 'onkeyup', 'tabindex'];
      if (interactive_attrs.some(attr => attr in node.attributes)) return true;

      const role = node.attributes.role;
      const interactive_roles = new Set(['button', 'link', 'menuitem', 'option', 'radio', 'checkbox', 'tab', 'textbox', 'combobox', 'slider', 'spinbutton', 'search', 'searchbox', 'row', 'cell', 'gridcell']);
      if (interactive_roles.has(role)) return true;
    }

    if (node.ax_node) {
      const interactive_ax_roles = new Set(['button', 'link', 'menuitem', 'option', 'radio', 'checkbox', 'tab', 'textbox', 'combobox', 'slider', 'spinbutton', 'listbox', 'search', 'searchbox', 'row', 'cell', 'gridcell']);
      if (interactive_ax_roles.has(node.ax_node.role)) return true;
      
      for (const prop of node.ax_node.properties || []) {
        if (['checked', 'expanded', 'pressed', 'selected', 'focusable', 'editable', 'settable'].includes(prop.name) && prop.value) return true;
      }
    }

    if (node.snapshot_node?.cursor_style === 'pointer') return true;

    return false;
  }

  static has_form_control_descendant(node, max_depth = 2) {
    if (max_depth <= 0) return false;
    for (const child of node.children_and_shadow_roots) {
      if (child.node_type !== NodeType.ELEMENT_NODE) continue;
      if (['input', 'select', 'textarea'].includes(child.tag_name)) return true;
      if (this.has_form_control_descendant(child, max_depth - 1)) return true;
    }
    return false;
  }
}

export class DomService {
  constructor(page) {
    this.page = page;
  }

  async get_dom_tree() {
    const client = await this.page.target().createCDPSession();
    
    // 1. Capture snapshot
    const snapshot = await client.send('DOMSnapshot.captureSnapshot', {
      computedStyles: REQUIRED_COMPUTED_STYLES,
      includePaintOrder: true,
      includeDOMRects: true
    });

    // 2. Get accessibility tree
    const ax_tree = await client.send('Accessibility.getFullAXTree');

    // 3. Get DOM tree
    const dom_tree = await client.send('DOM.getDocument', { depth: -1, pierce: true });

    // 4. Get viewport ratio
    const metrics = await client.send('Page.getLayoutMetrics');
    const device_pixel_ratio = metrics.visualViewport.clientWidth / metrics.cssVisualViewport.clientWidth;

    await client.detach();

    // 5. Build snapshot lookup
    const snapshot_lookup = this.build_snapshot_lookup(snapshot, device_pixel_ratio);

    // 6. Build AX lookup
    const ax_lookup = {};
    for (const node of ax_tree.nodes) {
      if (node.backendDOMNodeId) ax_lookup[node.backendDOMNodeId] = node;
    }

    // 7. Construct enhanced tree (Simplified)
    const root = await this.construct_enhanced_node(dom_tree.root, snapshot_lookup, ax_lookup);
    
    // 8. Inject backend-node-id for selector-based actions
    await this.inject_backend_ids(client, root);

    return root;
  }

  async inject_backend_ids(client, node) {
    if (node.node_type === NodeType.ELEMENT_NODE) {
      try {
        await client.send('DOM.setAttributeValue', {
          nodeId: node.node_id,
          name: 'data-backend-node-id',
          value: node.backend_node_id.toString()
        });
      } catch (e) {
        // May fail for some nodes
      }
    }
    for (const child of node.children_and_shadow_roots) {
      await this.inject_backend_ids(client, child);
    }
  }

  build_snapshot_lookup(snapshot, dpr) {
    const lookup = {};
    const strings = snapshot.strings;
    
    for (const doc of snapshot.documents) {
      const nodes = doc.nodes;
      const layout = doc.layout;
      const backend_to_index = {};
      nodes.backendNodeId.forEach((id, i) => backend_to_index[id] = i);
      
      const layout_index_map = {};
      layout.nodeIndex.forEach((ni, i) => { if (!(ni in layout_index_map)) layout_index_map[ni] = i; });

      const clickables = new Set(nodes.isClickable?.index || []);

      for (const [id, idx] of Object.entries(backend_to_index)) {
        let bounds, styles = {}, cursor;
        if (idx in layout_index_map) {
          const lidx = layout_index_map[idx];
          const b = layout.bounds[lidx];
          if (b) bounds = new DOMRect(b[0]/dpr, b[1]/dpr, b[2]/dpr, b[3]/dpr);
          
          (layout.styles[lidx] || []).forEach((si, i) => {
            styles[REQUIRED_COMPUTED_STYLES[i]] = strings[si];
          });
          cursor = styles.cursor;
        }

        lookup[id] = new EnhancedSnapshotNode({
          is_clickable: clickables.has(idx),
          cursor_style: cursor,
          bounds,
          computed_styles: styles
        });
      }
    }
    return lookup;
  }

  async construct_enhanced_node(node, snapshot_lookup, ax_lookup) {
    const ax = ax_lookup[node.backendNodeId];
    let enhanced_ax = null;
    if (ax) {
      enhanced_ax = new EnhancedAXNode(
        ax.nodeId, ax.ignored, 
        ax.role?.value, ax.name?.value, ax.description?.value,
        (ax.properties || []).map(p => new EnhancedAXProperty(p.name, p.value?.value)),
        ax.childIds
      );
    }

    const attrs = {};
    if (node.attributes) {
      for (let i = 0; i < node.attributes.length; i += 2) {
        attrs[node.attributes[i]] = node.attributes[i+1];
      }
    }

    const snapshot = snapshot_lookup[node.backendNodeId];

    const enhanced = new EnhancedDOMTreeNode({
      node_id: node.nodeId,
      backend_node_id: node.backendNodeId,
      node_type: node.nodeType,
      node_name: node.nodeName,
      node_value: node.nodeValue,
      attributes: attrs,
      ax_node: enhanced_ax,
      snapshot_node: snapshot
    });

    if (node.children) {
      enhanced.children = await Promise.all(node.children.map(c => this.construct_enhanced_node(c, snapshot_lookup, ax_lookup)));
    }
    if (node.contentDocument) {
      enhanced.content_document = await this.construct_enhanced_node(node.contentDocument, snapshot_lookup, ax_lookup);
    }
    if (node.shadowRoots) {
      enhanced.shadow_roots = await Promise.all(node.shadowRoots.map(s => this.construct_enhanced_node(s, snapshot_lookup, ax_lookup)));
    }

    return enhanced;
  }
}

export class DOMTreeSerializer {
  constructor(root) {
    this.root = root;
    this.selector_map = {};
  }

  serialize() {
    const simplified = this.create_simplified_tree(this.root);
    this.assign_indices(simplified);
    return new SerializedDOMState(simplified, this.selector_map);
  }

  create_simplified_tree(node) {
    if (node.node_type === NodeType.DOCUMENT_NODE) {
      for (const child of node.children_and_shadow_roots) {
        const s = this.create_simplified_tree(child);
        if (s) return s;
      }
      return null;
    }

    if (node.node_type === NodeType.ELEMENT_NODE) {
      if (DISABLED_ELEMENTS.has(node.tag_name)) return null;
      if (SVG_ELEMENTS.has(node.tag_name)) return null;

      const children = [];
      for (const child of node.children_and_shadow_roots) {
        const s = this.create_simplified_tree(child);
        if (s) children.push(s);
      }

      const is_interactive = ClickableElementDetector.is_interactive(node);
      const is_visible = !!node.snapshot_node?.bounds;

      if (is_visible || children.length > 0) {
        return new SimplifiedNode({ original_node: node, children });
      }
    } else if (node.node_type === NodeType.TEXT_NODE) {
      if (node.node_value?.trim().length > 1) {
        return new SimplifiedNode({ original_node: node, children: [] });
      }
    }
    return null;
  }

  assign_indices(node) {
    if (!node) return;
    const is_interactive = ClickableElementDetector.is_interactive(node.original_node);
    if (is_interactive && node.original_node.snapshot_node?.bounds) {
      node.is_interactive = true;
      this.selector_map[node.original_node.backend_node_id] = node.original_node;
    }
    for (const child of node.children) this.assign_indices(child);
  }
}
