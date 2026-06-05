import * as vscode from 'vscode';
import type { EntityType } from '../model/OntologyModel';
import { getLabel } from '../model/OntologyModel';
import type { OntologyIndex } from '../model/OntologyIndex';

interface SearchResult {
  iri: string;
  label: string;
  entityType: EntityType;
}

const TYPE_BADGE: Record<EntityType, string> = {
  class: 'C',
  objectProperty: 'OP',
  dataProperty: 'DP',
  annotationProperty: 'AP',
  individual: 'I',
};

const BAR_HEIGHT = 32; // px — search bar height; must match CSS

export class SearchWebviewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private index: OntologyIndex | undefined;
  private preferredLang = 'en';

  constructor(
    private readonly onSelect: (iri: string, entityType: EntityType) => void,
  ) {}

  setIndex(index: OntologyIndex | undefined, preferredLang: string): void {
    this.index = index;
    this.preferredLang = preferredLang;
    this.view?.webview.postMessage({ type: 'clear' });
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.buildHtml();

    webviewView.webview.onDidReceiveMessage(msg => {
      if (msg.type === 'search') {
        const results = this.runSearch(msg.query as string);
        void webviewView.webview.postMessage({ type: 'results', results });
      } else if (msg.type === 'focus') {
        this.onSelect(msg.iri as string, msg.entityType as EntityType);
      }
    });
  }

  private runSearch(query: string): SearchResult[] {
    if (!this.index || !query.trim()) { return []; }
    return this.index.searchByLabel(query.trim(), 100).map(e => ({
      iri: e.iri,
      label: getLabel(e, this.preferredLang),
      entityType: e.type,
    }));
  }

  private buildHtml(): string {
    const typeBadgeJson = JSON.stringify(TYPE_BADGE);
    const barH = BAR_HEIGHT;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: transparent;
    height: ${barH}px;
    overflow: visible;
  }
  .search-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    height: ${barH}px;
    background: var(--vscode-sideBar-background, transparent);
  }
  #searchInput {
    flex: 1;
    min-width: 0;
    height: 24px;
    padding: 0 6px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    outline: none;
    font-family: inherit;
    font-size: inherit;
  }
  #searchInput::placeholder { color: var(--vscode-input-placeholderForeground); }
  #searchInput:focus { border-color: var(--vscode-focusBorder); }
  #searchBtn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    cursor: pointer;
    flex-shrink: 0;
  }
  #searchBtn:hover { background: var(--vscode-button-hoverBackground); }
  #results {
    position: fixed;
    top: ${barH}px;
    left: 0;
    right: 0;
    max-height: calc(100vh - ${barH}px);
    overflow-y: auto;
    background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    border-top: none;
    box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    z-index: 9999;
    display: none;
  }
  #results.visible { display: block; }
  .result-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    cursor: pointer;
    user-select: none;
    min-height: 22px;
  }
  .result-item:hover { background: var(--vscode-list-hoverBackground); }
  .result-item.active {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }
  .badge {
    flex-shrink: 0;
    font-size: 10px;
    font-weight: 600;
    padding: 0 3px;
    border-radius: 2px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    min-width: 18px;
    text-align: center;
    line-height: 14px;
  }
  .lbl {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .no-results {
    padding: 6px 8px;
    color: var(--vscode-descriptionForeground);
    font-style: italic;
    font-size: 0.9em;
  }
</style>
</head>
<body>
  <div class="search-bar">
    <input id="searchInput" type="text" placeholder="Search entities…" autocomplete="off" spellcheck="false" />
    <button id="searchBtn" title="Search">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
      </svg>
    </button>
  </div>
  <div id="results"></div>
<script>
  const vscode = acquireVsCodeApi();
  const TYPE_BADGE = ${typeBadgeJson};
  const input = document.getElementById('searchInput');
  const resultsDiv = document.getElementById('results');
  let debounce;
  let activeIdx = -1;
  let currentResults = [];

  function search() {
    const q = input.value;
    if (!q.trim()) { hideResults(); return; }
    vscode.postMessage({ type: 'search', query: q });
  }

  function hideResults() {
    currentResults = [];
    activeIdx = -1;
    resultsDiv.innerHTML = '';
    resultsDiv.classList.remove('visible');
  }

  input.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(search, 180); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { clearTimeout(debounce); search(); }
    else if (e.key === 'Escape') { hideResults(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
  });
  document.getElementById('searchBtn').addEventListener('click', () => { clearTimeout(debounce); search(); });

  function moveActive(dir) {
    const items = resultsDiv.querySelectorAll('.result-item');
    if (!items.length) return;
    items[activeIdx]?.classList.remove('active');
    activeIdx = Math.max(0, Math.min(items.length - 1, activeIdx + dir));
    items[activeIdx].classList.add('active');
    items[activeIdx].scrollIntoView({ block: 'nearest' });
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'results') {
      activeIdx = -1;
      currentResults = msg.results;
      if (!currentResults.length) {
        resultsDiv.innerHTML = '<div class="no-results">No results</div>';
        resultsDiv.classList.add('visible');
        return;
      }
      resultsDiv.innerHTML = currentResults.map((r, i) =>
        '<div class="result-item" data-i="' + i + '">' +
        '<span class="badge">' + escHtml(TYPE_BADGE[r.entityType] || r.entityType) + '</span>' +
        '<span class="lbl" title="' + escHtml(r.iri) + '">' + escHtml(r.label) + '</span>' +
        '</div>'
      ).join('');
      resultsDiv.classList.add('visible');
      resultsDiv.querySelectorAll('.result-item').forEach(el => {
        el.addEventListener('click', () => {
          const r = currentResults[+el.dataset.i];
          if (r) vscode.postMessage({ type: 'focus', iri: r.iri, entityType: r.entityType });
        });
      });
    } else if (msg.type === 'clear') {
      hideResults();
      input.value = '';
    }
  });
</script>
</body>
</html>`;
  }
}
