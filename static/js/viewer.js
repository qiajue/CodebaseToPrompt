/**
 * viewer.js
 *
 * Contains the FileTreeViewer class which now delegates actual tree rendering
 * to our new <tree-view> web component. We only handle:
 *  - Building the in-memory "tree data"
 *  - Toggling expansions / selections in the Store
 *  - Listening for events from <tree-view> and updating the Store
 *  - "Expand All" / "Collapse All" / "Select All" / "Deselect All" / "Clear" in the UI
 */

import { actions } from './actions.js';
import { isSpreadsheet, parseSpreadsheetFile, isPDF, parsePDFFile } from './indexing.js';
import { isTextLikely } from './helpers.js';

// We import our web component (tree-view.js) in index.html or main.js, so we can also import here if needed:
import './tree-view.js';

export class FileTreeViewer {
  constructor(store) {
    this.store = store;
    // The <tree-view> custom element
    this.container = document.getElementById('fileTree');

    // Listen for events from <tree-view>:
    this.container.addEventListener('selection-changed', (evt) => {
      // The web component has new selectedPaths
      this.store.dispatch(async (draft) => {
        draft.selectedPaths = new Set(evt.detail.selectedPaths);
      }).then(() => {
        this.store.dispatch(actions.updateStats());
      });
    });

    this.container.addEventListener('expansion-changed', (evt) => {
      this.store.dispatch(async (draft) => {
        draft.expandedNodes = new Set(evt.detail.expandedPaths);
      });
    });

    // Set up the top-level UI buttons
    document.getElementById('expandAllButton').addEventListener('click', () => {
      this.expandAll();
    });
    document.getElementById('collapseAllButton').addEventListener('click', () => {
      this.collapseAll();
    });
    document.getElementById('selectAllButton').addEventListener('click', () => {
      this.selectAll();
    });
    document.getElementById('deselectAllButton').addEventListener('click', () => {
      this.deselectAll();
    });
    document.getElementById('clearButton').addEventListener('click', () => {
      this.clearAll();
    });

    // Copy selected content
    document.getElementById('copyButton').addEventListener('click', () => {
      this.copyToClipboard();
    });

    // Directory input
    document.getElementById('directoryInput').addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      this.handleFileSelect(files);
      e.target.value = ''; // reset
    });
  }

  /**
   * handleFileSelect - scans the user-chosen files, filters out ignored ones,
   * figures out text vs binary, builds a root object, loads file content, etc.
   */
  async handleFileSelect(files) {
    // Filter out ignored directories/files
    files = files.filter((file) => {
      const parts = file.webkitRelativePath.split('/');
      // skip if any directory is ignored
      if (['node_modules','venv','.git','__pycache__','.idea','.vscode'].some((dir) => parts.includes(dir))) {
        return false;
      }
      // skip if file matches an ignored filename or extension
      if ([
        '.DS_Store','Thumbs.db','.env','.pyc','.jpg','.jpeg','.png','.gif',
        '.mp4','.mov','.avi','.webp','.mkv','.wmv','.flv','.svg','.zip','.tar','.gz',
        '.rar','.exe','.bin','.iso','.dll','.psd','.ai','.eps','.tiff','.woff',
        '.woff2','.ttf','.otf','.flac','.m4a','.aac','.mov','.3gp'
      ].some((ignored) => {
        if (ignored.startsWith('.')) {
          return file.name.toLowerCase().endsWith(ignored.toLowerCase());
        }
        return file.name === ignored;
      })) {
        return false;
      }
      return true;
    });

    if (!files.length) return;

    // Decide which are text
    const fileTypeMap = new Map();
    for (const file of files) {
      const lower = file.name.toLowerCase();
      if (
        [
          '.txt','.md','.markdown','.json','.js','.ts','.jsx','.tsx','.css','.scss','.sass',
          '.less','.html','.htm','.xml','.yaml','.yml','.ini','.conf','.cfg','.config','.py',
          '.rb','.php','.java','.c','.cpp','.h','.hpp','.cs','.go','.rs','.swift','.kt','.kts',
          '.sh','.bash','.zsh','.fish','.sql','.graphql','.vue','.svelte','.astro','.env.example',
          '.gitignore','.dockerignore','.editorconfig','.eslintrc','.prettierrc','.babelrc','LICENSE',
          'README','CHANGELOG','TODO','.csv','.tsv'
        ].some((ext) => lower.endsWith(ext)) ||
        isSpreadsheet(file.name) || isPDF(file.name)
      ) {
        fileTypeMap.set(file.webkitRelativePath, true);
      } else {
        const textLikely = await isTextLikely(file);
        fileTypeMap.set(file.webkitRelativePath, textLikely);
      }
    }

    // Build root object
    const root = this.buildFileTree(files, fileTypeMap);

    // Save to store
    await this.store.dispatch(actions.setRoot(root));

    // Then load contents
    for (const file of files) {
      if (!fileTypeMap.get(file.webkitRelativePath)) continue;
      let text = '';
      if (isSpreadsheet(file.name)) {
        text = await parseSpreadsheetFile(file);
      } else if (isPDF(file.name)) {
        text = await parsePDFFile(file);
      } else {
        text = await file.text();
      }
      await this.store.dispatch(actions.setFileContents(file.webkitRelativePath, text));
    }

    await this.store.dispatch(actions.updateStats());
  }

  buildFileTree(files, fileTypeMap) {
    if (!files.length) return null;
    const basePath = files[0].webkitRelativePath.split('/')[0];
    const root = {
      name: basePath,
      path: basePath,
      isDir: true,
      children: [],
    };

    files.forEach((file) => {
      const parts = file.webkitRelativePath.split('/');
      let current = root;
      parts.forEach((part, idx) => {
        if (idx === 0) return; // skip the top-level folder
        const pathSoFar = parts.slice(0, idx + 1).join('/');
        if (idx === parts.length - 1) {
          // file
          current.children.push({
            name: part,
            path: pathSoFar,
            isDir: false,
            size: file.size,
            isTextFile: fileTypeMap.get(file.webkitRelativePath),
          });
        } else {
          // directory
          let childDir = current.children.find((c) => c.name === part && c.isDir);
          if (!childDir) {
            childDir = {
              name: part,
              path: pathSoFar,
              isDir: true,
              children: [],
            };
            current.children.push(childDir);
          }
          current = childDir;
        }
      });
    });
    return root;
  }

  /**
   * Called whenever store state changes.
   * We pass the new data into <tree-view>.
   */
  handleStateChange(state) {
    // If no root, do nothing
    if (!state.root) {
      this.container.data = null;
      return;
    }
    // re-bind data
    this.container.data = state.root;
    // these can remain sets
    this.container.selectedPaths = state.selectedPaths;
    this.container.expandedPaths = state.expandedNodes;

    // Also update the "Selected Files" panel, token stats, etc.
    this.updateUI(state);
  }

  updateUI(state) {
    // Show stats
    document.getElementById('selectedCount').textContent = state.stats.selectedCount;
    document.getElementById('estimatedTokens').textContent = state.stats.totalTokens;

    // Show the selected files in the <pre> area
    const lines = [];
    // Add an ASCII tree of selected only
    lines.push(`<folder-structure>\n${this.generateAsciiTree(state.root, state.selectedPaths)}\n</folder-structure>`);
    // Then each selected file as <document path="...">
    for (const path of state.selectedPaths) {
      const content = state.fileContents[path];
      if (content) {
        lines.push(`<document path="${path}">\n${content}\n</document>`);
      }
    }
    document.getElementById('selectedFilesContent').textContent = lines.join('\n\n');
  }

  /**
   * Simple ASCII-tree for selected items
   */
  generateAsciiTree(node, selectedPaths, prefix = '', isLast = true) {
    const nodeSelected = selectedPaths.has(node.path);
    const childSelected = node.children?.some(
      (ch) => selectedPaths.has(ch.path) || (ch.isDir && this.anyChildSelected(ch, selectedPaths))
    );
    if (!nodeSelected && !childSelected) {
      return '';
    }
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';
    let result = prefix + connector + node.name + '\n';

    if (node.children) {
      const visible = node.children.filter(
        (ch) => selectedPaths.has(ch.path) || (ch.isDir && this.anyChildSelected(ch, selectedPaths))
      );
      visible.forEach((child, index) => {
        const lastChild = index === visible.length - 1;
        result += this.generateAsciiTree(child, selectedPaths, prefix + childPrefix, lastChild);
      });
    }
    return result;
  }
  anyChildSelected(node, selectedPaths) {
    if (!node.children) return false;
    return node.children.some((ch) => selectedPaths.has(ch.path) || (ch.isDir && this.anyChildSelected(ch, selectedPaths)));
  }

  /**
   * Expand / collapse / select / etc. all files
   */
  async expandAll() {
    const state = this.store.getState();
    if (!state.root) return;
    const pathsToExpand = [];
    this.walk(state.root, (node) => {
      if (node.isDir) pathsToExpand.push(node.path);
    });
    await this.store.dispatch(actions.bulkSetExpanded(pathsToExpand, []));
  }

  async collapseAll() {
    const state = this.store.getState();
    if (!state.root) return;
    const pathsToCollapse = [];
    this.walk(state.root, (node) => {
      if (node.isDir) pathsToCollapse.push(node.path);
    });
    await this.store.dispatch(actions.bulkSetExpanded([], pathsToCollapse));
  }

  async selectAll() {
    const state = this.store.getState();
    if (!state.root) return;
    const pathsToSelect = [];
    this.walk(state.root, (node) => {
      if (!node.isDir && node.isTextFile) {
        pathsToSelect.push(node.path);
      }
    });
    await this.store.dispatch(actions.bulkSelectPaths(pathsToSelect, []));
    await this.store.dispatch(actions.updateStats());
  }

  async deselectAll() {
    const state = this.store.getState();
    if (!state.root) return;
    const pathsToDeselect = [];
    this.walk(state.root, (node) => {
      if (!node.isDir && node.isTextFile) {
        pathsToDeselect.push(node.path);
      }
    });
    await this.store.dispatch(actions.bulkSelectPaths([], pathsToDeselect));
    await this.store.dispatch(actions.updateStats());
  }

  async clearAll() {
    await this.store.dispatch(actions.reset());
    document.getElementById('directoryInput').value = '';
    // the UI will update once store triggers handleStateChange
  }

  async copyToClipboard() {
    const text = document.getElementById('selectedFilesContent').textContent || '';
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById('copyButton');
    btn.textContent = 'Copied!';
    setTimeout(() => {
      btn.textContent = 'Copy to Clipboard';
    }, 1500);
  }

  walk(node, fn) {
    fn(node);
    if (node.children) {
      for (const child of node.children) {
        this.walk(child, fn);
      }
    }
  }
}
