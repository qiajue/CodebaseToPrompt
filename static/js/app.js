const LOCAL_STORAGE_KEY = 'treeState';

// State Management
const Store = (function () {
  let instance;
  let subscribers = new Set();

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
        return structuredClone(state);
      },

      dispatch(action) {
        const draft = structuredClone(state);
        action(draft);

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

  // If you want to explicitly set expand vs collapse:
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
};

// Spreadsheet detection
function isSpreadsheet(filename) {
  if (!filename) return false;

  const spreadsheetExtensions = ['.xls', '.xlsx', '.xlsm', '.xlsb', '.xlt', '.ods', '.fods', '.numbers'];
  const lower = filename.toLowerCase();
  return spreadsheetExtensions.some((ext) => lower.endsWith(ext));
}

function isPDF(filename) {
  if (!filename) return false;
  return filename.toLowerCase().endsWith('.pdf');
}

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
        .replace(/\s+/g, ' ') // Normalize multiple spaces
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

async function parseSpreadsheetFile(file) {
  // Return a Promise that resolves to a text representation of the spreadsheet
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
    // Read the spreadsheet file as an ArrayBuffer
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

    this.store.subscribe(this.handleStateChange.bind(this));
    this.setupEventListeners();
  }

  async isTextFile(file) {
    // If it's a spreadsheet or PDF, treat them as "extractable text"
    if (isSpreadsheet(file.name) || isPDF(file.name)) {
      return true;
    }

    // Existing binary detection logic for other files
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

    const fileTypeMap = new Map();
    for (const file of files) {
      fileTypeMap.set(file.webkitRelativePath, await this.isTextFile(file));
    }

    const root = this.buildFileTree(files, fileTypeMap);
    this.store.dispatch(actions.setRoot(root));

    for (const file of files) {
      if (!fileTypeMap.get(file.webkitRelativePath)) {
        // Skip binary or unsupported formats
        continue;
      }

      let text = '';
      if (isSpreadsheet(file.name)) {
        text = await parseSpreadsheetFile(file);
      } else if (isPDF(file.name)) {
        text = await parsePDFFile(file); // PDF ADDITION
      } else {
        text = await file.text();
      }

      this.store.dispatch(actions.setFileContents(file.webkitRelativePath, text));
    }

    this.store.dispatch(actions.updateStats());
    event.target.value = '';
  }

  buildFileTree(files, fileTypeMap) {
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

    // Render the tree HTML
    this.container.innerHTML = this.renderNode(state.root);

    // After the container has been populated, set `indeterminate` on each checkbox
    const allCheckboxes = this.container.querySelectorAll('.tree-checkbox');
    allCheckboxes.forEach((checkbox) => {
      const isIndeterminate = checkbox.getAttribute('data-indeterminate') === 'true';
      checkbox.indeterminate = isIndeterminate;
    });
  }

  renderNode(node, level = 0) {
    const state = this.store.getState();
    const indent = level * 20;
    const icon = node.isDir
      ? state.expandedNodes.has(node.path)
        ? '📂'
        : '📁'
      : node.isTextFile
      ? '📄'
      : '📦';

    // Calculate selection state for folders or files
    const selectionState = node.isDir
      ? this.getFolderSelectionState(node)
      : {
          checked: state.selectedPaths.has(node.path),
          indeterminate: false,
        };

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
                  ${selectionState.checked ? 'checked' : ''}
                  data-indeterminate="${selectionState.indeterminate}"
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
        html += this.renderNode(child, level + 1);
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
    // For folders, we look at whether it's fully checked or partially/un-checked
    const selectionState = node.isDir
      ? this.getFolderSelectionState(node)
      : { checked: state.selectedPaths.has(node.path) };

    // If folder is indeterminate or unchecked, select all. If fully checked, deselect all
    const selected = node.isDir ? !selectionState.checked : !selectionState.checked;

    const updateNode = (currentNode) => {
      if (!currentNode.isDir && currentNode.isTextFile) {
        this.store.dispatch(actions.toggleSelected(currentNode.path, selected));
      }
      currentNode.children?.forEach(updateNode);
    };

    updateNode(node);
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
    document.getElementById('collapseAllButton').addEventListener('click', () => this.toggleAll(false));
    document.getElementById('selectAllButton').addEventListener('click', () => this.selectAll(true));
    document.getElementById('deselectAllButton').addEventListener('click', () => this.selectAll(false));
    document.getElementById('clearButton').addEventListener('click', () => this.clearAll());
    document.getElementById('copyButton').addEventListener('click', () => this.copyToClipboard());

    this.container.addEventListener('click', this.handleNodeClick.bind(this));
  }

  /**
   * toggleAll(expand):
   * Instead of toggling each folder, let's explicitly set each folder to expanded or not.
   */
  toggleAll(expand) {
    const recurseExpand = (node) => {
      if (node.isDir) {
        // Explicitly set expanded or collapsed
        this.store.dispatch(actions.setExpanded(node.path, expand));
        node.children?.forEach(recurseExpand);
      }
    };
    const root = this.store.getState().root;
    if (root) recurseExpand(root);
  }

  selectAll(select) {
    const toggleNode = (node) => {
      if (!node.isDir && node.isTextFile) {
        this.store.dispatch(actions.toggleSelected(node.path, select));
      }
      node.children?.forEach(toggleNode);
    };
    toggleNode(this.store.getState().root);
    this.store.dispatch(actions.updateStats());
  }

  clearAll() {
    this.store.dispatch(actions.reset());
    document.getElementById('directoryInput').value = '';
    document.getElementById('selectedFilesContent').textContent = ''; // Clear the prompt area
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
    content.push(`<folder-structure>\n${this.generateAsciiTree()}</folder-structure>\n`);

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
      if (!state.selectedPaths.has(node.path) && !this.hasSelectedDescendant(node)) {
        return '';
      }

      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = isLast ? '    ' : '│   ';
      let result = prefix + connector + node.name + '\n';

      if (node.children) {
        const visibleChildren = node.children.filter(
          (child) => state.selectedPaths.has(child.path) || this.hasSelectedDescendant(child)
        );

        visibleChildren.forEach((child, index) => {
          result += generateBranch(child, prefix + childPrefix, index === visibleChildren.length - 1);
        });
      }

      return result;
    };

    return generateBranch(state.root);
  }

  hasSelectedDescendant(node) {
    const state = this.store.getState();
    if (!node.children) return false;
    return node.children.some(
      (child) => state.selectedPaths.has(child.path) || this.hasSelectedDescendant(child)
    );
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

  // A helper method to determine how many files are selected in a folder
  getFolderSelectionState(node) {
    const state = this.store.getState();
    let totalFiles = 0;
    let selectedFiles = 0;

    const countFiles = (currentNode) => {
      if (!currentNode.isDir && currentNode.isTextFile) {
        totalFiles++;
        if (state.selectedPaths.has(currentNode.path)) {
          selectedFiles++;
        }
      }
      currentNode.children?.forEach(countFiles);
    };

    countFiles(node);

    return {
      checked: totalFiles > 0 && selectedFiles === totalFiles,
      indeterminate: selectedFiles > 0 && selectedFiles < totalFiles,
    };
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
  // Create store first to ensure localStorage is loaded
  const store = Store.getInstance();

  // Pass store to viewer
  const viewer = new FileTreeViewer(store);

  // If we have existing state, render it
  if (store.getState().root) {
    viewer.renderTree();
    viewer.updateUI();
  }
});
