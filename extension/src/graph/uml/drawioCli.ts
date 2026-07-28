import * as cp from 'child_process';
import * as fs from 'fs';

const MAC_DRAWIO_PATH = '/Applications/draw.io.app/Contents/MacOS/draw.io';
const DEFAULT_MAX_TEXTURE_SIZE = 16384;

/**
 * Spec §8.1: draw.io's PNG export rasterizes through a GPU-backed canvas capped at 16384px in
 * one dimension. Middle ear's diagram (~2760px wide) was fine at scale 2; liver's (~4155px wide)
 * failed at scale 2 but succeeded at scale 1. Drop to scale 1 whenever `canvasWidth * 2` would
 * meet or exceed the cap, rather than letting the export silently fail or crash the GPU process.
 */
export function pickPngScale(canvasWidth: number, maxTextureSize = DEFAULT_MAX_TEXTURE_SIZE): 1 | 2 {
  return canvasWidth * 2 >= maxTextureSize ? 1 : 2;
}

/**
 * Resolves the draw.io desktop CLI binary to invoke. Prefers the known macOS app-bundle path
 * (matching `uml-diagram-generation-spec.md` §8.1's documented install location) when present;
 * otherwise falls back to a `drawio` command on PATH (the common install name on other
 * platforms, or a manually-added PATH entry on macOS).
 */
export function resolveDrawioBinary(platform: NodeJS.Platform, existsSync: (p: string) => boolean): string {
  if (platform === 'darwin' && existsSync(MAC_DRAWIO_PATH)) { return MAC_DRAWIO_PATH; }
  return 'drawio';
}

export interface DrawioExportResult {
  success: boolean;
  stderr: string;
}

/**
 * Shells out to the local draw.io desktop CLI to export a `.drawio` file to PNG with
 * `--embed-diagram` — mandatory per spec §8.1, since it embeds the mxfile XML in a PNG `zTXt`
 * chunk, making the exported image reopen as a fully editable diagram in draw.io rather than a
 * flat image (the "editable PNG" this feature was asked for).
 */
export function exportPngViaDrawioCli(
  drawioFilePath: string,
  pngOutputPath: string,
  scale: 1 | 2,
): Promise<DrawioExportResult> {
  return new Promise(resolve => {
    const bin = resolveDrawioBinary(process.platform, fs.existsSync);
    cp.execFile(
      bin,
      ['--export', '--embed-diagram', '--format', 'png', '--scale', String(scale), '--border', '20', '--output', pngOutputPath, drawioFilePath],
      (error, _stdout, stderr) => {
        resolve({ success: !error, stderr: stderr || (error ? error.message : '') });
      },
    );
  });
}
