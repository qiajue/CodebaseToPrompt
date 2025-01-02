const LOCAL_STORAGE_KEY = 'treeState';

// State Management
const Store = (function () {
  let instance;
  let subscribers = new Set();

  // We'll keep an initialState here
  const initialState = {
    root: null,
    selectedPaths: new Set(),
    fileContents: {},
    expandedNodes: new Set(),
    stats: {
      selectedCount: 0,
      totalTokens: 0,
    },
  };

  function createInstance() {
    let state = Object.freeze({ ...initialState, ...loadState() });

    return {
      getState() {
        // Return a shallow clone or structured clone:
        // but in a big app, you might just return references 
        // to reduce overhead. For now, keep a safe copy.
        return structuredClone(state);
      },

      dispatch(action) {
        // Instead of multiple calls, we expect a single "mutation function"
        const draft = structuredClone(state);
        action(draft);

        // Freeze next state to maintain immutability
        const nextState = Object.freeze(draft);

        if (nextState !== state) {
          state = nextState;
          this.notify();
          saveState(state);
        }
      },

      subscribe(callback) {
        subscribers.add(callback);
        return () => subscribers.delete(callback);
      },

      notify() {
        subscribers.forEach((callback) => callback(state));
      },
    };
  }

  function saveState(state) {
    const serializedState = {
      ...state,
      selectedPaths: Array.from(state.selectedPaths),
      expandedNodes: Array.from(state.expandedNodes),
    };
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(serializedState));
  }

  function loadState() {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!saved) return {};

    const state = JSON.parse(saved);
    return {
      ...state,
      selectedPaths: new Set(state.selectedPaths),
      expandedNodes: new Set(state.expandedNodes),
    };
  }

  return {
    getInstance() {
      if (!instance) {
        instance = createInstance();
      }
      return instance;
    },
  };
})();

// Actions
const actions = {
  setRoot: (root) => (state) => {
    state.root = root;
  },

  // Instead of toggling each item repeatedly, we accept an array or set of paths
  // to add or remove in a single batch.
  bulkSelectPaths: (pathsToSelect = [], pathsToDeselect = []) => (state) => {
    for (const path of pathsToSelect) {
      state.selectedPaths.add(path);
    }
    for (const path of pathsToDeselect) {
      state.selectedPaths.delete(path);
    }
  },

  // Toggling a single path is still allowed, but we generally encourage 
  // single dispatch usage with "bulkSelectPaths".
  toggleSelected: (path, selected) => (state) => {
    if (selected) {
      state.selectedPaths.add(path);
    } else {
      state.selectedPaths.delete(path);
    }
  },

  toggleExpanded: (path) => (state) => {
    if (state.expandedNodes.has(path)) {
      state.expandedNodes.delete(path);
    } else {
      state.expandedNodes.add(path);
    }
  },

  setExpanded: (path, expand) => (state) => {
    if (expand) {
      state.expandedNodes.add(path);
    } else {
      state.expandedNodes.delete(path);
    }
  },

  setFileContents: (path, content) => (state) => {
    state.fileContents[path] = content;
  },

  updateStats: () => (state) => {
    state.stats.selectedCount = state.selectedPaths.size;
    state.stats.totalTokens = calculateTokens(state.fileContents, state.selectedPaths);
  },

  reset: () => (state) => {
    // Re-initialize everything to the original initialState
    state.root = null;
    state.selectedPaths = new Set();
    state.fileContents = {};
    state.expandedNodes = new Set();
    state.stats.selectedCount = 0;
    state.stats.totalTokens = 0;
  },

  bulkSetExpanded: (pathsToExpand = [], pathsToCollapse = []) => (state) => {
    for (const path of pathsToExpand) {
      state.expandedNodes.add(path);
    }
    for (const path of pathsToCollapse) {
      state.expandedNodes.delete(path);
    }
  },
};

// Helper: determine if a file is a spreadsheet
function isSpreadsheet(filename) {
  if (!filename) return false;

  const spreadsheetExtensions = [
    '.xls', '.xlsx', '.xlsm', '.xlsb', 
    '.xlt', '.ods', '.fods', '.numbers',
  ];
  const lower = filename.toLowerCase();
  return spreadsheetExtensions.some((ext) => lower.endsWith(ext));
}

// Helper: determine if a file is a PDF
function isPDF(filename) {
  if (!filename) return false;
  return filename.toLowerCase().endsWith('.pdf');
}

// Parse PDF file
async function parsePDFFile(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const typedArray = new Uint8Array(arrayBuffer);
    const loadingTask = pdfjsLib.getDocument({ data: typedArray });
    const pdf = await loadingTask.promise;
    let textOutput = '';

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Filter out empty strings and join with proper spacing
      const pageText = textContent.items
        .filter((item) => item.str.trim().length > 0)
        .map((item) => {
          // Handle different types of spaces and line breaks
          if (item.hasEOL) return item.str + '\n';
          return item.str + ' ';
        })
        .join('')
        .replace(/\s+/g, ' ')
        .trim();

      if (pageText) {
        textOutput += pageText + '\n\n';
      }
    }

    return textOutput.trim();
  } catch (err) {
    console.error('PDF parsing error:', err);
    throw new Error(`Failed to parse PDF: ${err.message}`);
  }
}

// Parse spreadsheet file
async function parseSpreadsheetFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        let textOutput = '';

        // Convert each sheet in the workbook to CSV and append
        workbook.SheetNames.forEach((sheetName) => {
          const worksheet = workbook.Sheets[sheetName];
          const csv = XLSX.utils.sheet_to_csv(worksheet);
          textOutput += `Sheet: ${sheetName}\n${csv}\n\n`;
        });

        resolve(textOutput.trim());
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}

class FileTreeViewer {
  constructor(store) {
    this.store = store;
    this.container = document.getElementById('fileTree');

    // Adjust these ignored paths as needed
    this.IGNORED_DIRECTORIES = ['node_modules', 'venv', '.git', '__pycache__', '.idea', '.vscode'];
    this.IGNORED_FILES = [
      '.DS_Store',
      'Thumbs.db',
      '.env',
      '.pyc',
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.mp4',
      '.mov',
      '.avi',
      '.webp',
      '.mkv',
      '.wmv',
      '.flv',
      '.svg',
      '.zip',
      '.tar',
      '.gz',
      '.rar',
      '.exe',
      '.bin',
      '.iso',
      '.dll',
      '.psd',
      '.ai',
      '.eps',
      '.tiff',
      '.woff',
      '.woff2',
      '.ttf',
      '.otf',
      '.flac',
      '.m4a',
      '.aac',
      '.mov',
      '.3gp',
    ];

    // Add LIKELY_TEXT_FILES list
    this.LIKELY_TEXT_FILES = [
      '.txt', '.md', '.markdown', '.json', '.js', '.ts', '.jsx', '.tsx',
      '.css', '.scss', '.sass', '.less', '.html', '.htm', '.xml', '.yaml',
      '.yml', '.ini', '.conf', '.cfg', '.config', '.py', '.rb', '.php',
      '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.swift',
      '.kt', '.kts', '.sh', '.bash', '.zsh', '.fish', '.sql', '.graphql',
      '.vue', '.svelte', '.astro', '.env.example', '.gitignore', '.dockerignore',
      '.editorconfig', '.eslintrc', '.prettierrc', '.babelrc', 'LICENSE',
      'README', 'CHANGELOG', 'TODO', '.csv', '.tsv'
    ];

    // Subscribe to store updates
    this.store.subscribe(this.handleStateChange.bind(this));
    this.setupEventListeners();
  }

  async isTextFile(file) {
    // First check known text extensions
    if (this.LIKELY_TEXT_FILES.some(ext => 
      file.name.toLowerCase().endsWith(ext.toLowerCase())
    )) {
      return true;
    }

    // Then check spreadsheets and PDFs
    if (isSpreadsheet(file.name) || isPDF(file.name)) {
      return true;
    }

    // Fall back to content analysis for unknown extensions
    const slice = file.slice(0, 4096);
    const text = await slice.text();
    const printableChars = text.match(/[\x20-\x7E\n\r\t\u00A0-\u02AF\u0370-\u1CFF]/g);
    return printableChars && printableChars.length / text.length > 0.7;
  }

  async handleFileSelect(event) {
    const files = Array.from(event.target.files || []).filter(
      (file) =>
        !this.IGNORED_DIRECTORIES.some((dir) => file.webkitRelativePath.split('/').includes(dir)) &&
        !this.IGNORED_FILES.some((ignoredFile) => {
          // If ignoredFile starts with a dot, treat it as an extension
          if (ignoredFile.startsWith('.')) {
            return file.name.toLowerCase().endsWith(ignoredFile.toLowerCase());
          }
          // Otherwise, do an exact filename match
          return file.name === ignoredFile;
        })
    );

    if (!files.length) return;

    // Determine if each file is text
    const fileTypeMap = new Map();
    for (const file of files) {
      fileTypeMap.set(file.webkitRelativePath, await this.isTextFile(file));
    }

    // Build the root tree structure
    const root = this.buildFileTree(files, fileTypeMap);
    this.store.dispatch(actions.setRoot(root));

    // Parse file contents in batch
    for (const file of files) {
      if (!fileTypeMap.get(file.webkitRelativePath)) {
        continue; // skip binary or unsupported
      }

      let text = '';
      if (isSpreadsheet(file.name)) {
        text = await parseSpreadsheetFile(file);
      } else if (isPDF(file.name)) {
        text = await parsePDFFile(file);
      } else {
        text = await file.text();
      }

      this.store.dispatch(actions.setFileContents(file.webkitRelativePath, text));
    }

    this.store.dispatch(actions.updateStats());
    event.target.value = '';
  }

  buildFileTree(files, fileTypeMap) {
    // The first part (index 0) is the root folder name
    // This is a naive approach if multiple top-level folders are possible 
    // but usually there's one main folder from the input.
    const root = {
      name: files[0].webkitRelativePath.split('/')[0],
      path: files[0].webkitRelativePath.split('/')[0],
      isDir: true,
      children: [],
    };

    files.forEach((file) => {
      const pathParts = file.webkitRelativePath.split('/');
      let currentNode = root;

      pathParts.forEach((part, index) => {
        if (index === 0) return;

        const currentPath = pathParts.slice(0, index + 1).join('/');

        if (index === pathParts.length - 1) {
          const isTextFile = fileTypeMap.get(file.webkitRelativePath);
          currentNode.children.push({
            name: part,
            path: currentPath,
            isDir: false,
            size: file.size,
            isTextFile,
          });
        } else {
          let childNode = currentNode.children.find((n) => n.name === part);
          if (!childNode) {
            childNode = {
              name: part,
              path: currentPath,
              isDir: true,
              children: [],
            };
            currentNode.children.push(childNode);
          }
          currentNode = childNode;
        }
      });
    });

    return root;
  }

  renderTree() {
    const state = this.store.getState();
    if (!state.root) {
      this.container.innerHTML =
        '<div class="upload-message">Select a directory to view its contents</div>';
      return;
    }

    // We'll do a single pass to compute each node's selection state
    // so we don't repeatedly call expensive functions in `renderNode`.
    const selectionMap = this.computeSelectionStates(state);

    // Render the tree HTML
    this.container.innerHTML = this.renderNode(state.root, selectionMap);

    // After the container has been populated, set `indeterminate` on each checkbox
    const allCheckboxes = this.container.querySelectorAll('.tree-checkbox');
    allCheckboxes.forEach((checkbox) => {
      const isIndeterminate = checkbox.getAttribute('data-indeterminate') === 'true';
      checkbox.indeterminate = isIndeterminate;
    });
  }

  // Single pass to compute each node's "checked" and "indeterminate" state:
  computeSelectionStates(state) {
    // We'll store a map of path -> { checked: bool, indeterminate: bool }
    const selectionMap = {};

    // Recursive function that returns { totalFiles, selectedFiles }
    // so we can compute folder selection state in one pass.
    const computeStateForNode = (node) => {
      if (!node.isDir) {
        if (node.isTextFile && state.selectedPaths.has(node.path)) {
          // 1 selected file
          selectionMap[node.path] = { checked: true, indeterminate: false };
          return { totalFiles: 1, selectedFiles: 1 };
        } else {
          selectionMap[node.path] = { checked: false, indeterminate: false };
          return { totalFiles: node.isTextFile ? 1 : 0, selectedFiles: 0 };
        }
      }

      let total = 0;
      let selected = 0;
      node.children?.forEach((child) => {
        const result = computeStateForNode(child);
        total += result.totalFiles;
        selected += result.selectedFiles;
      });

      if (total > 0 && selected === total) {
        selectionMap[node.path] = { checked: true, indeterminate: false };
      } else if (selected > 0 && selected < total) {
        selectionMap[node.path] = { checked: false, indeterminate: true };
      } else {
        selectionMap[node.path] = { checked: false, indeterminate: false };
      }
      return { totalFiles: total, selectedFiles: selected };
    };

    // Start with root
    computeStateForNode(state.root);
    return selectionMap;
  }

  renderNode(node, selectionMap, level = 0) {
    const state = this.store.getState();
    const indent = level * 20;
    const icon = node.isDir
      ? state.expandedNodes.has(node.path)
        ? '📂'
        : '📁'
      : node.isTextFile
      ? '📄'
      : '📦';

    const selState = selectionMap[node.path] || { checked: false, indeterminate: false };

    let html = `
      <div class="tree-node" style="margin-left: ${indent}px" data-path="${node.path}">
        <div class="tree-node-content">
          ${
            node.isTextFile !== false
              ? `
                <input
                  type="checkbox"
                  class="tree-checkbox"
                  data-path="${node.path}"
                  ${selState.checked ? 'checked' : ''}
                  data-indeterminate="${selState.indeterminate}"
                >
              `
              : ''
          }
          <span class="tree-node-icon">${icon}</span>
          <span class="tree-node-name">${node.name}${
      node.size ? ` (${this.formatSize(node.size)})` : ''
    }</span>
        </div>
      </div>
    `;

    if (node.isDir && state.expandedNodes.has(node.path) && node.children) {
      const sortedChildren = [...node.children].sort((a, b) => {
        if (a.isDir === b.isDir) return a.name.localeCompare(b.name);
        return b.isDir - a.isDir;
      });

      sortedChildren.forEach((child) => {
        html += this.renderNode(child, selectionMap, level + 1);
      });
    }

    return html;
  }

  formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  handleNodeClick(event) {
    const checkbox = event.target.closest('.tree-checkbox');
    const content = event.target.closest('.tree-node-content');
    if (!content) return;

    const path = content.closest('.tree-node').dataset.path;
    const node = this.findNode(path);
    if (!node) return;

    if (checkbox) {
      this.toggleNodeSelection(node);
    } else if (node.isDir) {
      // If directory, expand/collapse
      this.store.dispatch(actions.toggleExpanded(node.path));
    }
  }

  toggleNodeSelection(node) {
    const state = this.store.getState();
    // We'll do a recursive approach in a single pass, then one dispatch
    const pathsToSelect = [];
    const pathsToDeselect = [];

    // Instead of repeated dispatches, gather everything first
    const recurse = (currentNode) => {
      if (!currentNode.isDir && currentNode.isTextFile) {
        // Check if currently selected or not
        const isCurrentlySelected = state.selectedPaths.has(currentNode.path);
        if (isCurrentlySelected) {
          // We'll mark for deselect
          pathsToDeselect.push(currentNode.path);
        } else {
          // We'll mark for select
          pathsToSelect.push(currentNode.path);
        }
      }
      currentNode.children?.forEach(recurse);
    };

    if (node.isDir) {
      // For a folder, we see if it is fully selected 
      // (meaning all text files are selected)
      // or partially/none selected -> then we do the opposite.
      const { totalFiles, selectedFiles } = this.countFiles(node, state.selectedPaths);
      const isFullySelected = totalFiles > 0 && selectedFiles === totalFiles;

      if (isFullySelected) {
        // Deselect everything under it
        const collectAll = (n) => {
          if (!n.isDir && n.isTextFile) {
            pathsToDeselect.push(n.path);
          }
          n.children?.forEach(collectAll);
        };
        collectAll(node);
      } else {
        // Select everything under it
        const collectAll = (n) => {
          if (!n.isDir && n.isTextFile) {
            pathsToSelect.push(n.path);
          }
          n.children?.forEach(collectAll);
        };
        collectAll(node);
      }
    } else {
      // It's a file
      const isSelected = state.selectedPaths.has(node.path);
      if (isSelected) {
        pathsToDeselect.push(node.path);
      } else {
        pathsToSelect.push(node.path);
      }
    }

    // Now one dispatch for all changes
    this.store.dispatch(actions.bulkSelectPaths(pathsToSelect, pathsToDeselect));
    this.store.dispatch(actions.updateStats());
  }

  findNode(path, node = this.store.getState().root) {
    if (!node) return null;
    if (node.path === path) return node;
    if (!node.children) return null;

    for (const child of node.children) {
      const found = this.findNode(path, child);
      if (found) return found;
    }
    return null;
  }

  setupEventListeners() {
    const directoryInput = document.getElementById('directoryInput');
    directoryInput.addEventListener('change', (e) => this.handleFileSelect(e));

    document.getElementById('expandAllButton').addEventListener('click', () => this.toggleAll(true));
    document.getElementById('collapseAllButton').addEventListener('click', () =>
      this.toggleAll(false)
    );
    document.getElementById('selectAllButton').addEventListener('click', () => this.selectAll(true));
    document.getElementById('deselectAllButton').addEventListener('click', () =>
      this.selectAll(false)
    );
    document.getElementById('clearButton').addEventListener('click', () => this.clearAll());
    document.getElementById('copyButton').addEventListener('click', () => this.copyToClipboard());

    this.container.addEventListener('click', this.handleNodeClick.bind(this));
  }

  // Instead of dispatching for every node, we do one pass through the tree
  // and then dispatch a single bulk update.
  toggleAll(expand) {
    const state = this.store.getState();
    const pathsToExpand = [];
    const pathsToCollapse = [];

    const gather = (node) => {
      if (node.isDir) {
        if (expand) {
          pathsToExpand.push(node.path);
        } else {
          pathsToCollapse.push(node.path);
        }
        node.children?.forEach(gather);
      }
    };

    if (state.root) {
      gather(state.root);
      // Single dispatch for all changes
      this.store.dispatch(actions.bulkSetExpanded(pathsToExpand, pathsToCollapse));
    }
  }

  // Single pass for selectAll or deselectAll
  selectAll(select) {
    const state = this.store.getState();
    const pathsToSelect = [];
    const pathsToDeselect = [];

    const gather = (node) => {
      if (!node.isDir && node.isTextFile) {
        const isSelected = state.selectedPaths.has(node.path);
        if (select && !isSelected) {
          pathsToSelect.push(node.path);
        } else if (!select && isSelected) {
          pathsToDeselect.push(node.path);
        }
      }
      node.children?.forEach(gather);
    };

    if (state.root) {
      gather(state.root);
      // Single dispatch
      this.store.dispatch(actions.bulkSelectPaths(pathsToSelect, pathsToDeselect));
      this.store.dispatch(actions.updateStats());
    }
  }

  clearAll() {
    this.store.dispatch(actions.reset());
    document.getElementById('directoryInput').value = '';
    document.getElementById('selectedFilesContent').textContent = '';
    this.renderTree();
    this.updateUI();
    // delete the local storage key
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  }

  copyToClipboard() {
    const content = this.generateSelectedContent();
    navigator.clipboard.writeText(content).then(() => {
      const button = document.getElementById('copyButton');
      button.textContent = 'Copied!';
      setTimeout(() => (button.textContent = 'Copy to Clipboard'), 2000);
    });
  }

  generateSelectedContent() {
    const state = this.store.getState();
    if (!state.root) return '';

    const content = [];
    content.push(`<folder-structure>\n${this.generateAsciiTree()}\n</folder-structure>`);

    for (const path of state.selectedPaths) {
      const text = state.fileContents[path];
      if (text) {
        content.push(`<document path="${path}">\n${text}\n</document>`);
      }
    }

    return content.join('\n\n');
  }

  generateAsciiTree() {
    const state = this.store.getState();
    if (!state.root) return '';

    const generateBranch = (node, prefix = '', isLast = true) => {
      // If neither this node nor its descendants are selected, skip
      const nodeSelected = state.selectedPaths.has(node.path);
      const descendantSelected = this.hasSelectedDescendant(node, state.selectedPaths);
      if (!nodeSelected && !descendantSelected) {
        return '';
      }

      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = isLast ? '    ' : '│   ';
      let result = prefix + connector + node.name + '\n';

      if (node.children) {
        const visibleChildren = node.children.filter(
          (child) => state.selectedPaths.has(child.path) || this.hasSelectedDescendant(child, state.selectedPaths)
        );

        visibleChildren.forEach((child, index) => {
          result += generateBranch(
            child,
            prefix + childPrefix,
            index === visibleChildren.length - 1
          );
        });
      }

      return result;
    };

    return generateBranch(state.root);
  }

  hasSelectedDescendant(node, selectedPaths) {
    if (!node.children) return false;
    return node.children.some(
      (child) => selectedPaths.has(child.path) || this.hasSelectedDescendant(child, selectedPaths)
    );
  }

  // Utility to count how many text files are under this node and 
  // how many are selected, so we can decide if it's "fully" selected or not.
  countFiles(node, selectedPaths) {
    let total = 0;
    let selected = 0;

    const recurse = (currentNode) => {
      if (!currentNode.isDir && currentNode.isTextFile) {
        total++;
        if (selectedPaths.has(currentNode.path)) {
          selected++;
        }
      }
      currentNode.children?.forEach(recurse);
    };
    recurse(node);

    return { totalFiles: total, selectedFiles: selected };
  }

  handleStateChange(state) {
    this.renderTree();
    this.updateUI();
    document.getElementById('selectedFilesContent').textContent = this.generateSelectedContent();
    document.getElementById('selectedCount').textContent = state.stats.selectedCount;
    document.getElementById('estimatedTokens').textContent = state.stats.totalTokens;
  }

  updateUI() {
    const state = this.store.getState();
    document.getElementById('selectedFilesContent').textContent = this.generateSelectedContent();
    document.getElementById('selectedCount').textContent = state.stats.selectedCount;
    document.getElementById('estimatedTokens').textContent = state.stats.totalTokens;
  }
}

function calculateTokens(fileContents, selectedPaths) {
  let totalChars = 0;
  for (const path of selectedPaths) {
    const content = fileContents[path];
    if (content) {
      totalChars += content.length;
    }
  }
  // Estimate 1 token per 4 characters as a rough approximation
  return Math.ceil(totalChars / 4);
}

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
  const store = Store.getInstance();
  const viewer = new FileTreeViewer(store);

  // If we have existing state, render it
  if (store.getState().root) {
    viewer.renderTree();
    viewer.updateUI();
  }
});
