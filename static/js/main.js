/**
 * main.js
 *
 * Orchestrates the UI: sets up the FileTreeViewer, wires DOM events,
 * and initializes from the store.
 */
import { Store } from './store.js';
import { FileTreeViewer } from './viewer.js';

document.addEventListener('DOMContentLoaded', async () => {
  // 1) Load the store from IndexedDB
  const store = await Store.getInstance();

  // 2) Create the viewer
  const viewer = new FileTreeViewer(store);

  // 3) Subscribe so that whenever the store changes, we re-render <tree-view> etc.
  store.subscribe((newState) => {
    viewer.handleStateChange(newState);
  });

  // 4) If there's already a root in the store, show it
  const currentState = store.getState();
  if (currentState.root) {
    viewer.handleStateChange(currentState);
  }
});

// Add this with your other event listeners
document.getElementById('selectTextButton').addEventListener('click', () => {
  const content = document.getElementById('selectedFilesContent');
  const range = document.createRange();
  range.selectNodeContents(content);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
});
