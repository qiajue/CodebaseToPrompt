/**
 * actions.js
 *
 * Exports a set of "action creators" that mutate the state draft.
 * Also writes file contents to localforage if needed.
 */
import { contentsDB, calculateTokens } from './helpers.js';

export const actions = {
  setRoot: (root) => async (state) => {
    state.root = root;
  },

  bulkSelectPaths: (pathsToSelect = [], pathsToDeselect = []) => async (state) => {
    for (const p of pathsToSelect) {
      state.selectedPaths.add(p);
    }
    for (const p of pathsToDeselect) {
      state.selectedPaths.delete(p);
    }
  },

  toggleSelected: (path, selected) => async (state) => {
    if (selected) {
      state.selectedPaths.add(path);
    } else {
      state.selectedPaths.delete(path);
    }
  },

  toggleExpanded: (path) => async (state) => {
    if (state.expandedNodes.has(path)) {
      state.expandedNodes.delete(path);
    } else {
      state.expandedNodes.add(path);
    }
  },

  setExpanded: (path, expand) => async (state) => {
    if (expand) {
      state.expandedNodes.add(path);
    } else {
      state.expandedNodes.delete(path);
    }
  },

  /**
   * Immediately store file content in memory + localforage.
   */
  setFileContents: (path, content) => async (state) => {
    state.fileContents[path] = content;
    await contentsDB.setItem(path, content);
  },

  updateStats: () => async (state) => {
    state.stats.selectedCount = state.selectedPaths.size;
    state.stats.totalTokens = calculateTokens(state.fileContents, state.selectedPaths);
  },

  reset: () => async (state) => {
    // Clear everything
    state.root = null;
    state.selectedPaths = new Set();
    state.fileContents = {};
    state.expandedNodes = new Set();
    state.stats.selectedCount = 0;
    state.stats.totalTokens = 0;

    // Also clear the contents DB
    const keys = await contentsDB.keys();
    for (const k of keys) {
      await contentsDB.removeItem(k);
    }
  },

  bulkSetExpanded: (pathsToExpand = [], pathsToCollapse = []) => async (state) => {
    for (const p of pathsToExpand) {
      state.expandedNodes.add(p);
    }
    for (const p of pathsToCollapse) {
      state.expandedNodes.delete(p);
    }
  },
};
