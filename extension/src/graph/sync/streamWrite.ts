import * as vscode from 'vscode';
import { recordSelfWrite } from './reloadGuard';

const CHUNK_CHARS = 1 << 20;

/**
 * Write a (potentially very large) string to a file without ever allocating
 * the full UTF-8 buffer at once.
 *
 * `vscode.workspace.fs.writeFile` requires a Uint8Array, so the naive path
 * (`TextEncoder.encode(text)` → writeFile) creates a fresh ~200MB buffer for a
 * 200MB ontology. Combined with the JS UTF-16 source string still live in
 * memory, that extra allocation is enough to crash the extension host on
 * SNOMED-scale saves.
 *
 * For local-disk URIs we use Node's `createWriteStream` and write the text in
 * ~1MB chunks. The stream's internal encoder converts each chunk and releases
 * the previous chunk's buffer before the next one is allocated, so peak
 * memory during write stays bounded at chunk size + stream highWaterMark.
 *
 * Non-file URIs (virtual filesystems, remote workspaces) fall back to the
 * VS Code FS API since Node `fs` cannot reach them.
 */
export async function writeTextStreamed(uri: vscode.Uri, text: string): Promise<void> {
  if (uri.scheme !== 'file') {
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
  } else {
    const { createWriteStream } = await import('node:fs');
    const stream = createWriteStream(uri.fsPath, { encoding: 'utf8' });
    await new Promise<void>((resolve, reject) => {
      stream.on('error', (err) => {
        console.error(`[OntoGraph writeStream] error: ${err.message}`);
        reject(err);
      });
      stream.on('finish', () => {
        resolve();
      });

      let i = 0;
      const writeNext = (): void => {
        while (i < text.length) {
          const end = Math.min(i + CHUNK_CHARS, text.length);
          const chunk = text.slice(i, end);
          i = end;
          if (!stream.write(chunk)) {
            stream.once('drain', writeNext);
            return;
          }
        }
        stream.end();
      };
      writeNext();
    });
  }

  // Capture mtime + size so the file watcher can distinguish our own writes
  // from external edits. Failing the stat is non-fatal — the watcher just
  // can't fingerprint-match and may reload defensively (which is correct
  // behavior when we can't prove ownership).
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    recordSelfWrite(uri.toString(), stat.mtime, stat.size);
  } catch {
    /* ignore */
  }
}
