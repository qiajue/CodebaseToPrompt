class TreeView extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // Add ARIA attributes to root
    this.setAttribute('role', 'tree');
    this.setAttribute('aria-multiselectable', 'true');
    this.setAttribute('aria-label', 'File tree'); // Or use aria-labelledby

    // Initialize state
    this._data = null;
    this._selectedPaths = new Set();
    this._expandedPaths = new Set();
    this._focusedPath = null;
    this._searchString = '';
    this._searchTimeout = null;

    // Bind methods
    this._handleClick = this._handleClick.bind(this);
    this._handleKeyDown = this._handleKeyDown.bind(this);

    // Create and attach styles
    const style = document.createElement('style');
    style.textContent = `
        :host {
          display: block;
          font-family: sans-serif;
          height: 100%;
          min-height: 0;
          position: relative;
          overflow: hidden;
        }
        :host > div {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          overflow-y: auto;
          overflow-x: hidden;
        }
        .upload-message {
          text-align: center;
          color: #6b7280;
          padding: 2rem;
        }
        .tree-node {
          display: block;
          margin: 0;
          padding: 0px 0px;
        }
        .node-content {
          border-bottom: 1px solid #e5e7eb;
          height: 32px;
          display: flex;
          align-items: center;
          cursor: pointer;
          padding: 6px 8px;
          border-radius: 4px;
          transition: all 0.2s ease;
        }
        .node-content:hover {
          background-color: #e8f0fe;
        }
        .checkbox {
          margin-right: 8px;
          cursor: pointer;
          width: 16px;
          height: 16px;
        }
        .folder-icon,
        .file-icon {
          margin-right: 8px;
          font-size: 1.1em;
          width: 20px;
          text-align: center;
        }
        .folder-icon {
          color: #c19a6b;
        }
        .file-icon {
          color: #555;
        }
        .node-content:focus {
          outline: 2px solid #2563eb;
          background-color: #e8f0fe;
        }
        .node-content[aria-selected="true"] {
          background-color: #e8f0fe;
        }
      `;
    this.shadowRoot.appendChild(style);

    // Create main container
    this._container = document.createElement('div');
    this.shadowRoot.appendChild(this._container);

    // Add event delegation
    this._container.addEventListener('click', this._handleClick);
    this._container.addEventListener('keydown', this._handleKeyDown);
  }

  // Getters/Setters for properties
  get data() {
    return this._data;
  }

  set data(value) {
    this._data = value;
    this._render();
  }

  get selectedPaths() {
    return this._selectedPaths;
  }

  set selectedPaths(value) {
    this._selectedPaths = new Set(value);
    this._render();
  }

  get expandedPaths() {
    return this._expandedPaths;
  }

  set expandedPaths(value) {
    this._expandedPaths = new Set(value);
    this._render();
  }

  // Main render method
  _render() {
    if (!this._data) {
      this._container.innerHTML =
        '<div class="upload-message">Select a directory to view its contents</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    this._renderNode(this._data, 0, fragment);

    // Clear and update container
    this._container.innerHTML = '';
    this._container.appendChild(fragment);
  }

  // Recursive node rendering
  _renderNode(node, level, parent) {
    const isExpanded = this._expandedPaths.has(node.path);
    const { checked, indeterminate } = this._computeCheckboxState(node);

    // Create node container
    const nodeDiv = document.createElement('div');
    nodeDiv.className = 'tree-node';

    // Create node content
    const contentDiv = document.createElement('div');
    contentDiv.className = 'node-content';
    contentDiv.style.marginLeft = `${level * 20}px`;
    contentDiv.dataset.path = node.path;
    contentDiv.dataset.type = node.isDir ? 'dir' : 'file';

    // Add proper ARIA roles and states
    contentDiv.setAttribute('role', 'treeitem');
    contentDiv.setAttribute('aria-level', level + 1);
    
    // Add checkbox if needed
    if (node.isDir || node.isTextFile) {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'checkbox';
      checkbox.checked = checked;
      checkbox.indeterminate = indeterminate;
      contentDiv.appendChild(checkbox);
      contentDiv.setAttribute('aria-selected', 
        this._selectedPaths.has(node.path) ? 'true' : 'false');
    }

    // Add icon
    const icon = document.createElement('span');
    icon.className = 'folder-icon';
    icon.textContent = node.isDir ? (isExpanded ? '📂' : '📁') : node.isTextFile ? '📄' : '📦';
    contentDiv.appendChild(icon);

    // Add name and size
    const nameSpan = document.createElement('span');
    nameSpan.textContent = node.name + (node.size ? ` (${this._formatSize(node.size)})` : '');
    contentDiv.appendChild(nameSpan);

    nodeDiv.appendChild(contentDiv);

    // Render children if expanded directory
    if (node.isDir && isExpanded && node.children) {
      const sortedChildren = [...node.children].sort((a, b) => {
        if (a.isDir === b.isDir) return a.name.localeCompare(b.name);
        return b.isDir - a.isDir;
      });

      // Create group container for children
      const groupDiv = document.createElement('div');
      groupDiv.setAttribute('role', 'group');
      nodeDiv.appendChild(groupDiv);
      
      // Move children rendering into group
      sortedChildren.forEach(child => {
        this._renderNode(child, level + 1, groupDiv);
      });
    }

    parent.appendChild(nodeDiv);

    contentDiv.tabIndex = 0;
    if (node.path === this._focusedPath) {
      contentDiv.focus();
    }
  }

  // Event delegation handler
  _handleClick(event) {
    const content = event.target.closest('.node-content');
    if (!content) return;

    const path = content.dataset.path;
    const node = this._findNodeByPath(path);
    if (!node) return;

    if (event.target.type === 'checkbox') {
      this._handleCheckboxClick(event, node);
    } else if (node.isDir) {
      this._toggleExpanded(path);
    }
  }

  // Helper to find node by path
  _findNodeByPath(path) {
    let result = null;
    this._walk(this._data, (node) => {
      if (node.path === path) {
        result = node;
      }
    });
    return result;
  }

  // Checkbox click handler
  _handleCheckboxClick(event, node) {
    event.stopPropagation();

    if (node.isDir) {
      const { total, selected } = this._countTextFiles(node);
      const fullySelected = total > 0 && total === selected;
      if (fullySelected) {
        this._unselectSubtree(node);
      } else {
        this._selectSubtree(node);
      }
    } else if (node.isTextFile) {
      if (this._selectedPaths.has(node.path)) {
        this._selectedPaths.delete(node.path);
      } else {
        this._selectedPaths.add(node.path);
      }
    }

    this.dispatchEvent(
      new CustomEvent('selection-changed', {
        detail: { selectedPaths: this._selectedPaths },
        bubbles: true,
        composed: true,
      })
    );

    this._render();
  }

  // Toggle directory expansion
  _toggleExpanded(path) {
    if (this._expandedPaths.has(path)) {
      this._expandedPaths.delete(path);
    } else {
      this._expandedPaths.add(path);
    }

    this.dispatchEvent(
      new CustomEvent('expansion-changed', {
        detail: { expandedPaths: this._expandedPaths },
        bubbles: true,
        composed: true,
      })
    );

    this._render();
  }

  // Helper methods (kept from original)
  _computeCheckboxState(node) {
    if (!node.isDir && !node.isTextFile) {
      return { checked: false, indeterminate: false };
    }

    if (!node.isDir) {
      return {
        checked: this._selectedPaths.has(node.path),
        indeterminate: false,
      };
    }

    let total = 0;
    let selected = 0;
    this._walk(node, (child) => {
      if (!child.isDir && child.isTextFile) {
        total++;
        if (this._selectedPaths.has(child.path)) {
          selected++;
        }
      }
    });

    if (total === 0) return { checked: false, indeterminate: false };
    if (selected === 0) return { checked: false, indeterminate: false };
    if (selected === total) return { checked: true, indeterminate: false };
    return { checked: false, indeterminate: true };
  }

  _countTextFiles(node) {
    let total = 0;
    let selected = 0;
    this._walk(node, (child) => {
      if (!child.isDir && child.isTextFile) {
        total++;
        if (this._selectedPaths.has(child.path)) {
          selected++;
        }
      }
    });
    return { total, selected };
  }

  _selectSubtree(node) {
    this._walk(node, (child) => {
      if (!child.isDir && child.isTextFile) {
        this._selectedPaths.add(child.path);
      }
    });
  }

  _unselectSubtree(node) {
    this._walk(node, (child) => {
      if (!child.isDir && child.isTextFile) {
        this._selectedPaths.delete(child.path);
      }
    });
  }

  _walk(node, fn) {
    fn(node);
    if (node.children) {
      node.children.forEach((child) => this._walk(child, fn));
    }
  }

  _formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let idx = 0;
    while (size >= 1024 && idx < units.length - 1) {
      size /= 1024;
      idx++;
    }
    return `${size.toFixed(1)} ${units[idx]}`;
  }

  // Add new keyboard handler
  _handleKeyDown(event) {
    const focused = this._findNodeByPath(this._focusedPath);
    if (!focused) return;

    switch (event.key) {
      case 'ArrowRight':
        if (focused.isDir && !this._expandedPaths.has(focused.path)) {
          this._toggleExpanded(focused.path);
        } else if (focused.isDir && focused.children?.length) {
          this._focusNode(focused.children[0].path);
        }
        break;
      
      case 'ArrowLeft':
        if (focused.isDir && this._expandedPaths.has(focused.path)) {
          this._toggleExpanded(focused.path);
        } else {
          const parent = this._findParentNode(focused.path);
          if (parent) this._focusNode(parent.path);
        }
        break;

      case 'ArrowDown':
        const next = this._findNextNode(focused.path);
        if (next) this._focusNode(next.path);
        break;

      case 'ArrowUp':
        const prev = this._findPrevNode(focused.path);
        if (prev) this._focusNode(prev.path);
        break;

      case 'Home':
        const first = this._findFirstNode();
        if (first) this._focusNode(first.path);
        break;

      case 'End':
        const last = this._findLastNode();
        if (last) this._focusNode(last.path);
        break;

      case ' ':
        if (focused.isTextFile || focused.isDir) {
          this._handleCheckboxClick({ stopPropagation: () => {} }, focused);
        }
        break;

      case 'Enter':
        if (focused.isDir) {
          this._toggleExpanded(focused.path);
        }
        break;

      default:
        if (event.key.length === 1) {
          this._handleTypeAhead(event.key);
        }
    }
  }

  // Add new helper methods
  _focusNode(path) {
    this._focusedPath = path;
    this._render();
  }

  _handleTypeAhead(char) {
    clearTimeout(this._searchTimeout);
    this._searchString += char.toLowerCase();
    
    const match = this._findNodeByPrefix(this._searchString);
    if (match) {
      this._focusNode(match.path);
    }

    this._searchTimeout = setTimeout(() => {
      this._searchString = '';
    }, 500);
  }
}

// Register the component
customElements.define('tree-view', TreeView);
