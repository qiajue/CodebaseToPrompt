/**
 * store.js
 *
 * Manages global app state using localforage for persistent storage:
 *   - fileMetadata: store overall tree, selected paths, expanded nodes, etc.
 *   - fileContents: store actual text of files keyed by path.
 */
import { actions } from './actions.js';
import { loadAllMetadata, saveAllMetadata, loadAllContents } from './helpers.js';

/**
 * A standard initial in-memory layout.
 */
const initialState = {
  root: null,
  selectedPaths: new Set(),
  fileContents: {},   // in-memory cache
  expandedNodes: new Set(),
  stats: {
    selectedCount: 0,
    totalTokens: 0,
  },
};

// We keep a singleton store reference
let instance = null;
let subscribers = new Set();

export class Store {
  /**
   * Private constructor: Use static getInstance() instead.
   */
  constructor() {
    this.state = null; // Will be loaded asynchronously
  }

  static async getInstance() {
    if (!instance) {
      instance = new Store();
      await instance._init();
    }
    return instance;
  }

  async _init() {
    // 1) Load metadata from IndexedDB
    const loadedMeta = await loadAllMetadata();
    const mergedState = {
      ...initialState,
      ...loadedMeta,
      selectedPaths: new Set(loadedMeta.selectedPaths || []),
      expandedNodes: new Set(loadedMeta.expandedNodes || []),
    };
    // 2) Load file contents for selected paths
    const contents = await loadAllContents(mergedState.selectedPaths);

    // Merge in-memory
    this.state = Object.freeze({
      ...mergedState,
      fileContents: contents,
    });
  }

  getState() {
    // Return a structured clone to avoid accidental direct mutation
    return structuredClone(this.state);
  }

  /**
   * The "dispatch" method: it takes an async action function that modifies
   * a draft of state, then we freeze & store it.
   */
  async dispatch(actionFn) {
    const draft = structuredClone(this.state);
    await actionFn(draft);
    const nextState = Object.freeze(draft);

    if (nextState !== this.state) {
      this.state = nextState;
      this._notify();
      // Save metadata (file tree, selected paths, etc.)
      await saveAllMetadata(this.state);
    }
  }

  subscribe(callback) {
    subscribers.add(callback);
    return () => {
      subscribers.delete(callback);
    };
  }

  _notify() {
    for (const cb of subscribers) {
      cb(this.state);
    }
  }
}
