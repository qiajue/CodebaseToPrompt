/**
 * helpers.js
 *
 * - localForage instances for metadata / contents
 * - load/save metadata
 * - load contents for selected paths
 * - token calculation
 * - text-likelihood check
 */

export const metadataDB = localforage.createInstance({
    name: 'CodebaseToPrompt',
    storeName: 'fileMetadata',
  });
  
  export const contentsDB = localforage.createInstance({
    name: 'CodebaseToPrompt',
    storeName: 'fileContents',
  });
  
  /**
   * Load the entire metadata object from IndexedDB
   */
  export async function loadAllMetadata() {
    const saved = await metadataDB.getItem('treeState');
    return saved || {};
  }
  
  /**
   * Save the current metadata object (root, selectedPaths, expandedNodes, stats).
   */
  export async function saveAllMetadata(state) {
    const serializable = {
      root: state.root,
      selectedPaths: Array.from(state.selectedPaths),
      expandedNodes: Array.from(state.expandedNodes),
      stats: state.stats,
    };
    await metadataDB.setItem('treeState', serializable);
  }
  
  /**
   * Only load contents for the currently selected paths (avoid loading everything).
   */
  export async function loadAllContents(selectedPaths) {
    const out = {};
    for (const path of selectedPaths) {
      const content = await contentsDB.getItem(path);
      if (content) {
        out[path] = content;
      }
    }
    return out;
  }
  
  /**
   * Estimate tokens by a rough 4-chars = 1 token approach.
   */
  export function calculateTokens(fileContents, selectedPaths) {
    let totalChars = 0;
    for (const path of selectedPaths) {
      const content = fileContents[path];
      if (content) {
        totalChars += content.length;
      }
    }
    // approximate 4 chars per token
    return Math.ceil(totalChars / 4);
  }
  
  /**
   * Attempt to read ~4KB and see how many "printable" characters exist
   * to guess if it's text or binary.
   */
  export async function isTextLikely(file) {
    const slice = file.slice(0, 4096);
    const text = await slice.text();
    const printableChars = text.match(/[\x20-\x7E\n\r\t\u00A0-\u02AF\u0370-\u1CFF]/g);
    return printableChars && printableChars.length / text.length > 0.7;
  }
  