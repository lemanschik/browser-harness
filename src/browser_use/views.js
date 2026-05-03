export class DOMRect {
  constructor(x, y, width, height) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }
}

export const NodeType = {
  ELEMENT_NODE: 1,
  TEXT_NODE: 3,
  DOCUMENT_NODE: 9,
  DOCUMENT_FRAGMENT_NODE: 11
};

export class EnhancedAXProperty {
  constructor(name, value) {
    this.name = name;
    this.value = value;
  }
}

export class EnhancedAXNode {
  constructor(ax_node_id, ignored, role, name, description, properties, child_ids) {
    this.ax_node_id = ax_node_id;
    this.ignored = ignored;
    this.role = role;
    this.name = name;
    this.description = description;
    this.properties = properties;
    this.child_ids = child_ids;
  }
}

export class EnhancedSnapshotNode {
  constructor({ is_clickable, cursor_style, bounds, clientRects, scrollRects, computed_styles, paint_order, stacking_contexts }) {
    this.is_clickable = is_clickable;
    this.cursor_style = cursor_style;
    this.bounds = bounds;
    this.clientRects = clientRects;
    this.scrollRects = scrollRects;
    this.computed_styles = computed_styles;
    this.paint_order = paint_order;
    this.stacking_contexts = stacking_contexts;
  }
}

export class EnhancedDOMTreeNode {
  constructor({ node_id, backend_node_id, node_type, node_name, node_value, attributes, children, parent_id, shadow_roots, content_document, ax_node, snapshot_node, has_js_click_listener }) {
    this.node_id = node_id;
    this.backend_node_id = backend_node_id;
    this.node_type = node_type;
    this.node_name = node_name;
    this.node_value = node_value;
    this.attributes = attributes || {};
    this.children = children || [];
    this.parent_id = parent_id;
    this.shadow_roots = shadow_roots || [];
    this.content_document = content_document;
    this.ax_node = ax_node;
    this.snapshot_node = snapshot_node;
    this.has_js_click_listener = has_js_click_listener || false;
    
    this.is_visible = false;
    this.is_interactive = false;
    this.is_actually_scrollable = false;
    this.hidden_elements_info = [];
    this.has_hidden_content = false;
    this.is_compound_component = false;
    this.is_new = false;
    this._compound_children = [];
  }

  get tag_name() {
    return this.node_name ? this.node_name.toLowerCase() : null;
  }

  get children_and_shadow_roots() {
    return [...this.children, ...this.shadow_roots];
  }
}

export class SimplifiedNode {
  constructor({ original_node, children, is_shadow_host }) {
    this.original_node = original_node;
    this.children = children || [];
    this.is_shadow_host = is_shadow_host || false;
    this.is_interactive = false;
    this.is_new = false;
    this.is_compound_component = false;
    this.excluded_by_parent = false;
    this.ignored_by_paint_order = false;
  }
}

export class SerializedDOMState {
  constructor(root, selector_map) {
    this.root = root;
    this.selector_map = selector_map;
  }
}
