import * as vscode from 'vscode';
import type { OntologyModel } from '../model/OntologyModel';
import { ParserRegistry } from '../parser/ParserRegistry';

function sourceFormatToLangId(format: string): string {
  switch (format) {
    case 'functional': return 'owl-functional';
    case 'manchester': return 'manchester';
    case 'turtle':     return 'turtle';
    case 'owl-xml':    return 'owl-xml';
    case 'rdf-xml':    return 'owl-xml';  // detectOwlFormat identifies <rdf:RDF in ≤2000 bytes
    default:           return 'auto';
  }
}

// Scope the Uint8Array `bytes` to a helper so it goes out of scope at return
// and becomes GC-eligible before we await the parser. Without this, the
// 200MB byte buffer + 400MB decoded UTF-16 string + worker-thread message
// copy + old model state all stack up on the main thread during reload.
async function readFileAsText(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return new TextDecoder().decode(bytes);
}

export async function reloadOntology(
  activeModel: OntologyModel,
  onReloaded: (model: OntologyModel) => void | Promise<void>,
): Promise<void> {
  try {
    const uri = vscode.Uri.parse(activeModel.sourceUri);
    const text = await readFileAsText(uri);
    const stat = await vscode.workspace.fs.stat(uri);
    const langId = sourceFormatToLangId(activeModel.sourceFormat);
    const model = await ParserRegistry.parseAsync(text, langId, activeModel.sourceUri);
    model.sourceMtimeMs = stat.mtime;
    model.sourceSize = stat.size;
    await onReloaded(model);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`OntoGraph: failed to reload ontology — ${msg}`);
  }
}
