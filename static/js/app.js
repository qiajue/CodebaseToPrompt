class FileTreeViewer {
    constructor() {
        this.stats = {
            selectedCount: 0
        };
        this.root = null;
        this.container = document.getElementById('fileTree');
        this.selectedPaths = new Set(JSON.parse(localStorage.getItem('selectedPaths') || '[]'));
        this.fileContents = JSON.parse(localStorage.getItem('fileContents') || '{}');
        this.treeStructure = JSON.parse(localStorage.getItem('treeStructure') || 'null');
        
        if (this.treeStructure) {
            this.root = this.treeStructure;
            this.renderTree();
            this.updateStats();
            this.updateSelectedFilesContent();
        }

        this.setupEventListeners();
        this.setupTreeListeners();
        this.setupClipboardButton();

        this.IGNORED_DIRECTORIES = [
            'node_modules',
            'venv',
            '.git',
            '__pycache__',
            '.idea',
            '.vscode',
            'dist',
            'build',
            'coverage'
        ];

        this.IGNORED_FILES = [
            '.DS_Store',
            'Thumbs.db',
            '.env',
            '*.pyc',
            '*.pyo',
            '*.pyd',
            '*.so',
            '*.dll',
            '*.dylib'
        ];
    }

    setupEventListeners() {
        // File input setup
        const directoryInput = document.getElementById('directoryInput');
        
        // Add browser compatibility check
        if (!('webkitdirectory' in directoryInput)) {
            alert('Your browser does not support directory upload. Please use a modern browser like Chrome or Edge.');
            return;
        }

        directoryInput.addEventListener('change', (e) => this.handleFileSelect(e));

        // Tree controls
        document.getElementById('expandAllButton').addEventListener('click', () => this.toggleAll(true));
        document.getElementById('collapseAllButton').addEventListener('click', () => this.toggleAll(false));
        document.getElementById('selectAllButton').addEventListener('click', () => this.selectAll(true));
        document.getElementById('deselectAllButton').addEventListener('click', () => this.selectAll(false));
    }

    async isTextFile(file) {
        try {
            // Try to read the first few KB of the file
            const slice = file.slice(0, 4096); // Read first 4KB
            const text = await slice.text();
            
            // Check if the text contains mostly printable characters
            // This regex matches common text characters including unicode
            const printableChars = text.match(/[\x20-\x7E\n\r\t\u00A0-\u02AF\u0370-\u1CFF]/g);
            if (!printableChars) return false;
            
            // If >30% of characters are non-printable, likely a binary file
            return (printableChars.length / text.length) > 0.7;
        } catch (error) {
            console.warn(`Error checking if ${file.name} is text:`, error);
            return false;
        }
    }

    async handleFileSelect(event) {
        const files = Array.from(event.target.files || []).filter(file => {
            const path = file.webkitRelativePath;
            return !this.IGNORED_DIRECTORIES.some(dir => 
                path.split('/').includes(dir)
            );
        });

        if (files.length > 0) {
            this.resetStats();
            
            // First, determine which files are text files
            const fileTypeMap = new Map();
            for (const file of files) {
                fileTypeMap.set(file.webkitRelativePath, await this.isTextFile(file));
            }
            
            this.root = this.buildFileTree(files, fileTypeMap);
            
            // Read and store file contents
            this.fileContents = {};
            for (const file of files) {
                if (fileTypeMap.get(file.webkitRelativePath)) {
                    try {
                        const text = await file.text();
                        this.fileContents[file.webkitRelativePath] = text;
                    } catch (error) {
                        console.error(`Error reading file ${file.webkitRelativePath}:`, error);
                    }
                }
            }
            
            // Modified: Remove the selectAll function and just set selected state
            this.selectedPaths.clear();  // Clear existing selections
            const selectNode = (node) => {
                node.selected = true;
                node.expanded = false;  // Ensure all folders are collapsed
                this.selectedPaths.add(node.path);
                node.children?.forEach(selectNode);
            };
            selectNode(this.root);
            
            // Save to localStorage
            localStorage.setItem('fileContents', JSON.stringify(this.fileContents));
            localStorage.setItem('treeStructure', JSON.stringify(this.root));
            localStorage.setItem('selectedPaths', JSON.stringify([...this.selectedPaths]));
            
            this.renderTree();
            this.updateStats();
            this.updateSelectedFilesContent();
        }
        event.target.value = '';
    }

    buildFileTree(files, fileTypeMap) {
        // Reset stats before building tree
        this.resetStats();

        const shouldIgnorePath = (path) => {
            // Check if any part of the path contains an ignored directory
            const containsIgnoredDir = this.IGNORED_DIRECTORIES.some(dir => 
                path.split('/').includes(dir)
            );
            if (containsIgnoredDir) return true;

            // Check if the file matches any ignored pattern
            const fileName = path.split('/').pop();
            return this.IGNORED_FILES.some(pattern => {
                if (pattern.includes('*')) {
                    const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
                    return regex.test(fileName);
                }
                return fileName === pattern;
            });
        };

        // Get the root folder name from the first file's path
        const rootFolderName = files[0].webkitRelativePath.split('/')[0];
        
        const root = {
            name: rootFolderName,
            path: rootFolderName,
            isDir: true,
            children: [],
            expanded: false,  // Ensure root is collapsed by default
            selected: false,
            indeterminate: false
        };

        files.forEach(file => {
            if (shouldIgnorePath(file.webkitRelativePath)) {
                return;
            }

            const pathParts = file.webkitRelativePath.split('/');
            let currentNode = root;
            let currentPath = '';

            pathParts.forEach((part, index) => {
                if (index === 0) return;
                
                currentPath = pathParts.slice(0, index + 1).join('/');
                
                if (index === pathParts.length - 1) {
                    if (!shouldIgnorePath(currentPath)) {
                        const isHidden = part.startsWith('.');
                        const isTextFile = fileTypeMap.get(file.webkitRelativePath);
                        const fileNode = {
                            name: part,
                            path: file.webkitRelativePath,
                            isDir: false,
                            size: file.size,
                            selected: false,
                            excluded: isHidden,
                            isTextFile: isTextFile,
                            selectable: isTextFile
                        };
                        currentNode.children.push(fileNode);
                        this.stats.fileCount++;
                        this.stats.totalSize += file.size;
                    }
                } else {
                    // Only count directories that aren't ignored
                    if (!shouldIgnorePath(currentPath)) {
                        // Directory node
                        let childNode = currentNode.children.find(n => n.name === part);
                        if (!childNode) {
                            const isHidden = part.startsWith('.');
                            childNode = {
                                name: part,
                                path: currentPath,
                                isDir: true,
                                children: [],
                                expanded: false,
                                selected: false,
                                indeterminate: false,
                                excluded: isHidden
                            };
                            currentNode.children.push(childNode);
                            this.stats.dirCount++;
                        }
                        currentNode = childNode;
                    }
                }
            });
        });

        return root;
    }

    renderTree() {
        if (!this.root) {
            this.container.innerHTML = `
                <div class="upload-message">
                    Select a directory to view its contents
                </div>
            `;
            return;
        }
        this.container.innerHTML = this.renderNode(this.root);
        
        // Set indeterminate states after rendering
        const checkboxes = this.container.querySelectorAll('.tree-checkbox[data-indeterminate="true"]');
        checkboxes.forEach(checkbox => checkbox.indeterminate = true);
    }

    renderNode(node, level = 0) {
        const indent = level === 0 ? 0 : level * 20;
        const icon = node.isDir ? (node.expanded ? '📂' : '📁') : (node.isTextFile ? '📄' : '📦');
        const size = node.size ? ` (${this.formatSize(node.size)})` : '';
        const nodeId = `node-${node.path.replace(/[/\\]/g, '-')}`;
        const excludedClass = node.excluded ? 'excluded' : '';
        const binaryClass = (!node.isDir && !node.isTextFile) ? 'binary-file' : '';
        
        let html = `
            <div class="tree-node ${excludedClass} ${binaryClass}" id="${nodeId}" style="margin-left: ${indent}px" tabindex="0">
                <div class="tree-node-content">
                    ${node.selectable !== false ? `
                        <input type="checkbox" 
                               class="tree-checkbox" 
                               ${node.selected ? 'checked' : ''} 
                               ${node.indeterminate ? 'data-indeterminate="true"' : ''}
                               data-path="${node.path}">
                    ` : ''}
                    <span class="tree-node-icon">${icon}</span>
                    <span class="tree-node-name">${node.name}${size}</span>
                    ${!node.isDir && !node.isTextFile ? '<span class="binary-badge">binary</span>' : ''}
                </div>
            </div>
        `;

        if (node.isDir && node.expanded && node.children) {
            node.children
                .sort((a, b) => {
                    if (a.isDir === b.isDir) return a.name.localeCompare(b.name);
                    return b.isDir - a.isDir;
                })
                .forEach(child => {
                    html += this.renderNode(child, level + 1);
                });
        }

        return html;
    }

    toggleAll(expand) {
        const toggleNode = (node) => {
            if (node.isDir) {
                node.expanded = expand;
                node.children?.forEach(toggleNode);
            }
        };
        toggleNode(this.root);
        this.renderTree();
    }

    selectAll(select) {
        const toggleNode = (node) => {
            node.selected = select;
            node.indeterminate = false;
            if (select) {
                this.selectedPaths.add(node.path);
            } else {
                this.selectedPaths.delete(node.path);
            }
            node.children?.forEach(toggleNode);
        };
        toggleNode(this.root);
        this.updateStats();
        this.renderTree();
        this.updateSelectedFilesContent();
    }

    resetStats() {
        this.stats = {
            selectedCount: 0
        };
    }

    updateStats() {
        // Count only selected files (not directories)
        const countSelectedFiles = (node = this.root) => {
            let count = 0;
            if (!node.isDir && node.selected) {
                count++;
            }
            if (node.children) {
                count += node.children.reduce((sum, child) => sum + countSelectedFiles(child), 0);
            }
            return count;
        };

        document.getElementById('selectedCount').textContent = countSelectedFiles().toString();
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

    findNode(path, node = this.root) {
        if (node.path === path) return node;
        if (!node.children) return null;
        for (const child of node.children) {
            const found = this.findNode(path, child);
            if (found) return found;
        }
        return null;
    }

    updateParentStates(node = this.root) {
        if (!node.isDir || !node.children || node.children.length === 0) return;

        const childStates = node.children.map(child => ({
            selected: child.selected,
            indeterminate: child.indeterminate
        }));

        const allSelected = childStates.every(state => state.selected);
        const allUnselected = childStates.every(state => !state.selected && !state.indeterminate);

        node.selected = allSelected;
        node.indeterminate = !allSelected && !allUnselected;
    }

    handleNodeClick(event) {
        const checkbox = event.target.closest('.tree-checkbox');
        const content = event.target.closest('.tree-node-content');
        
        if (!content) return;

        if (checkbox) {
            // Handle checkbox click
            const path = checkbox.dataset.path;
            const node = this.findNode(path);
            if (!node) return;

            const newState = !node.selected;
            this.updateNodeSelection(node, newState);
            this.updateParentStates();
            this.renderTree();
            this.updateStats();
        } else {
            // Handle expand/collapse
            const nodeId = content.closest('.tree-node').id;
            const path = nodeId.replace('node-', '').replace(/-/g, '/');
            const node = this.findNode(path);
            if (node && node.isDir) {
                node.expanded = !node.expanded;
                this.renderTree();
            }
        }
    }

    updateNodeSelection(node, selected) {
        // Only allow selection of text files and directories
        if (node.selectable === false) return;
        
        node.selected = selected;
        node.indeterminate = false;

        if (selected) {
            this.selectedPaths.add(node.path);
        } else {
            this.selectedPaths.delete(node.path);
        }

        if (node.children) {
            node.children.forEach(child => this.updateNodeSelection(child, selected));
        }

        // Save selected paths to localStorage
        localStorage.setItem('selectedPaths', JSON.stringify([...this.selectedPaths]));
        this.updateSelectedFilesContent();
    }

    setupTreeListeners() {
        this.container.addEventListener('click', this.handleNodeClick.bind(this));
        
        // Keyboard navigation
        this.container.addEventListener('keydown', (event) => {
            const activeElement = document.activeElement;
            const treeNode = activeElement.closest('.tree-node');
            if (!treeNode) return;

            switch(event.key) {
                case 'ArrowRight':
                    event.preventDefault();
                    const node = this.findNode(treeNode.id.replace('node-', '').replace(/-/g, '/'));
                    if (node && node.isDir && !node.expanded) {
                        node.expanded = true;
                        this.renderTree();
                    }
                    break;
                case 'ArrowLeft':
                    event.preventDefault();
                    const collapsibleNode = this.findNode(treeNode.id.replace('node-', '').replace(/-/g, '/'));
                    if (collapsibleNode && collapsibleNode.isDir && collapsibleNode.expanded) {
                        collapsibleNode.expanded = false;
                        this.renderTree();
                    }
                    break;
                case ' ':
                    event.preventDefault();
                    const checkbox = treeNode.querySelector('.tree-checkbox');
                    if (checkbox) {
                        checkbox.click();
                    }
                    break;
            }
        });
    }

    setupClipboardButton() {
        document.getElementById('copyButton').addEventListener('click', () => {
            const content = document.getElementById('selectedFilesContent').textContent;
            navigator.clipboard.writeText(content).then(() => {
                const button = document.getElementById('copyButton');
                button.textContent = 'Copied!';
                setTimeout(() => {
                    button.textContent = 'Copy to Clipboard';
                }, 2000);
            });
        });
    }

    async updateSelectedFilesContent() {
        const selectedFilesContent = document.getElementById('selectedFilesContent');
        let content = [];  // Use array to store documents

        for (const path of this.selectedPaths) {
            const node = this.findNode(path);
            if (node && !node.isDir) {
                const text = this.fileContents[path];
                if (text) {
                    // Each document is a separate array element
                    content.push(`<document path="${path}">\n${text}\n</document>\n\n`);
                }
            }
        }

        // Join with double newlines, ensuring each document starts at margin
        selectedFilesContent.textContent = content.join('\n\n');
    }
}

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
    const viewer = new FileTreeViewer();
});