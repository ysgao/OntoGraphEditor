import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeResult,
  TextDocumentSyncKind,
  DiagnosticSeverity,
  Diagnostic,
  Hover,
  CompletionItem,
  CompletionItemKind,
  MarkupKind,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParserRegistry } from '../../parser/ParserRegistry';
import { OntologyIndex } from '../../model/OntologyIndex';
import type { OntologyModel } from '../../model/OntologyModel';
import { getLabel } from '../../model/OntologyModel';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

interface DocState { model: OntologyModel; index: OntologyIndex }
const cache = new Map<string, DocState>();
const debounce = new Map<string, NodeJS.Timeout>();

// ── Language ID detection ─────────────────────────────────────────────────────

function langFromUri(uri: string): string {
  const u = uri.toLowerCase();
  if (u.endsWith('.ofn')) { return 'owl-functional'; }
  if (u.endsWith('.omn')) { return 'manchester'; }
  if (u.endsWith('.owl')) { return 'owl-xml'; }
  if (u.endsWith('.ttl')) { return 'turtle'; }
  return 'owl-functional';
}

// ── Parse + diagnostics ───────────────────────────────────────────────────────

function parseDoc(doc: TextDocument): void {
  const uri = doc.uri;
  const lang = langFromUri(uri);
  const diags: Diagnostic[] = [];

  try {
    const model = ParserRegistry.parse(doc.getText(), lang, uri);
    cache.set(uri, { model, index: new OntologyIndex(model) });
  } catch (e) {
    cache.delete(uri);
    const msg = e instanceof Error ? e.message : String(e);

    // Attempt to extract position from PEG/parser error messages
    // Format varies: "Expected X at line 12 column 5" or "line 12, col 5"
    const lineM = /\bline[:\s]+(\d+)/i.exec(msg);
    const colM  = /\bcol(?:umn)?[:\s]+(\d+)/i.exec(msg);
    const errLine = lineM ? Math.max(0, Number(lineM[1]) - 1) : 0;
    const errCol  = colM  ? Math.max(0, Number(colM[1])  - 1) : 0;

    diags.push({
      severity: DiagnosticSeverity.Error,
      range: {
        start: { line: errLine, character: errCol },
        end:   { line: errLine, character: errCol + 20 },
      },
      message: msg.split('\n')[0].slice(0, 300),
      source: 'OntoGraph',
    });
  }

  void connection.sendDiagnostics({ uri, diagnostics: diags });
}

function scheduleParseDoc(doc: TextDocument): void {
  const uri = doc.uri;
  const t = debounce.get(uri);
  if (t) { clearTimeout(t); }
  debounce.set(uri, setTimeout(() => {
    debounce.delete(uri);
    parseDoc(doc);
  }, 700));
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

connection.onInitialize((): InitializeResult => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    hoverProvider: true,
    completionProvider: {
      resolveProvider: false,
      triggerCharacters: [' ', ':', '<'],
    },
  },
}));

documents.onDidOpen(e => parseDoc(e.document));
documents.onDidChangeContent(e => scheduleParseDoc(e.document));
documents.onDidClose(e => {
  cache.delete(e.document.uri);
  debounce.get(e.document.uri) && clearTimeout(debounce.get(e.document.uri)!);
  debounce.delete(e.document.uri);
  void connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});

// ── Hover ─────────────────────────────────────────────────────────────────────

connection.onHover((params): Hover | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) { return null; }
  const state = cache.get(params.textDocument.uri);
  if (!state) { return null; }

  const token = tokenAtPos(doc.getText(), params.position.line, params.position.character);
  if (!token || token.length < 2) { return null; }

  const entity = resolveToken(token, state.model, state.index);
  if (!entity) { return null; }

  const label = getLabel(entity);
  const parts = [
    `**${label}** _(${friendlyType(entity.type)})_`,
    '',
    `\`${entity.iri}\``,
  ];
  const comment = entity.annotations['http://www.w3.org/2000/01/rdf-schema#comment'];
  if (comment?.length) { parts.push('', comment[0]); }

  return { contents: { kind: MarkupKind.Markdown, value: parts.join('\n') } };
});

// ── Completion ────────────────────────────────────────────────────────────────

connection.onCompletion((params): CompletionItem[] => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) { return []; }
  const state = cache.get(params.textDocument.uri);
  if (!state) { return []; }

  const prefix = wordBeforeCursor(doc.getText(), params.position.line, params.position.character);
  if (prefix.length < 1) { return []; }

  return state.index.searchByLabel(prefix, 40).map(e => ({
    label: getLabel(e),
    kind: completionKind(e.type),
    detail: e.iri,
    insertText: getLabel(e),
  }));
});

// ── Text helpers ──────────────────────────────────────────────────────────────

function isIdChar(c: string): boolean {
  return /[\wÀ-￿#/:.@\-]/.test(c);
}

function tokenAtPos(text: string, line: number, ch: number): string {
  const lines = text.split('\n');
  if (line >= lines.length) { return ''; }
  const ln = lines[line];
  let s = ch;
  while (s > 0 && isIdChar(ln[s - 1])) { s--; }
  let e = ch;
  while (e < ln.length && isIdChar(ln[e])) { e++; }
  return ln.slice(s, e);
}

function wordBeforeCursor(text: string, line: number, ch: number): string {
  const lines = text.split('\n');
  if (line >= lines.length) { return ''; }
  const ln = lines[line];
  let s = ch;
  while (s > 0 && isIdChar(ln[s - 1])) { s--; }
  return ln.slice(s, ch);
}

// ── Entity resolution ─────────────────────────────────────────────────────────

function resolveToken(word: string, model: OntologyModel, index: OntologyIndex) {
  // Angle-bracket IRI: <http://...>
  const clean = word.startsWith('<') && word.endsWith('>') ? word.slice(1, -1) : word;

  const byIri = index.getByIri(clean);
  if (byIri) { return byIri; }

  // Prefixed :local — expand with ontology base IRI
  if (clean.startsWith(':') && model.metadata.iri) {
    const full = model.metadata.iri + '#' + clean.slice(1);
    const byBase = index.getByIri(full);
    if (byBase) { return byBase; }
  }

  // Label match
  const byLabel = index.exactMatchByLabel(word);
  if (byLabel.length > 0) { return byLabel[0]; }

  // Bare local name + ontology base
  if (model.metadata.iri && /^[A-Za-z_][\w\-]*$/.test(word)) {
    const candidate = model.metadata.iri + '#' + word;
    const byCand = index.getByIri(candidate);
    if (byCand) { return byCand; }
  }

  return null;
}

function friendlyType(type: string): string {
  switch (type) {
    case 'class':               return 'Class';
    case 'objectProperty':      return 'Object Property';
    case 'dataProperty':        return 'Data Property';
    case 'annotationProperty':  return 'Annotation Property';
    case 'individual':          return 'Individual';
    default:                    return type;
  }
}

function completionKind(type: string): CompletionItemKind {
  switch (type) {
    case 'class':              return CompletionItemKind.Class;
    case 'objectProperty':     return CompletionItemKind.Property;
    case 'dataProperty':       return CompletionItemKind.Field;
    case 'annotationProperty': return CompletionItemKind.Reference;
    case 'individual':         return CompletionItemKind.Value;
    default:                   return CompletionItemKind.Text;
  }
}

documents.listen(connection);
connection.listen();
