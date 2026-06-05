import { workerData, parentPort } from 'worker_threads';
import { ParserRegistry } from './ParserRegistry';
import { buildModelSegmentIndex } from '../model/SegmentIndex';
import type { EntitySegment } from '../model/OntologyModel';

interface WorkerInput { text: string; languageId: string; uri: string; }
interface WorkerTiming { parse: number; index: number; }

/** Pack a Map<iri, EntitySegment> into flat Int32Arrays that can be zero-copy transferred. */
function packSegments(segs: Map<string, EntitySegment>): { iris: string[]; baseData: Int32Array; liFlat: Int32Array; liOffsets: Int32Array; lcsFlat: Int32Array; lcsOffsets: Int32Array; transfers: ArrayBuffer[] } {
  const iris: string[] = [];
  let totalLI = 0, totalLCS = 0;
  for (const [iri, seg] of segs) {
    iris.push(iri);
    totalLI  += seg.lineIndices?.length    ?? 0;
    totalLCS += seg.lineCharStarts?.length ?? 0;
  }
  const n = iris.length;
  const baseData   = new Int32Array(n * 4);
  const liFlat     = new Int32Array(totalLI);
  const lcsFlat    = new Int32Array(totalLCS);
  const liOffsets  = new Int32Array(n + 1);
  const lcsOffsets = new Int32Array(n + 1);
  let liPos = 0, lcsPos = 0, i = 0;
  for (const [, seg] of segs) {
    baseData[i * 4]     = seg.startLine;
    baseData[i * 4 + 1] = seg.endLine;
    baseData[i * 4 + 2] = seg.startChar;
    baseData[i * 4 + 3] = seg.endChar;
    liOffsets[i] = liPos;
    if (seg.lineIndices?.length)    { liFlat.set(seg.lineIndices, liPos);       liPos  += seg.lineIndices.length;    }
    lcsOffsets[i] = lcsPos;
    if (seg.lineCharStarts?.length) { lcsFlat.set(seg.lineCharStarts, lcsPos);  lcsPos += seg.lineCharStarts.length; }
    i++;
  }
  liOffsets[n] = liPos;
  lcsOffsets[n] = lcsPos;
  return {
    iris, baseData, liFlat, liOffsets, lcsFlat, lcsOffsets,
    transfers: [baseData.buffer, liFlat.buffer, lcsFlat.buffer, liOffsets.buffer, lcsOffsets.buffer],
  };
}

const { text, languageId, uri } = workerData as WorkerInput;
try {
  const tParse = Date.now();
  const model = ParserRegistry.parse(text, languageId, uri);
  const tIndex = Date.now();
  // Build entity segment index in worker thread — avoids blocking the extension host
  // for large ontologies (SNOMED-scale 2.9M-line files where this takes 3-5 seconds).
  buildModelSegmentIndex(model);
  const tPost = Date.now();
  const timing: WorkerTiming = { parse: tIndex - tParse, index: tPost - tIndex };

  // Pack EntitySegment maps into flat transferable buffers.
  // Transferring avoids structured-clone of 100k+ EntitySegment objects and their Int32Array contents.
  const entityPack = model.entitySegments ? packSegments(model.entitySegments) : null;
  const gciPack    = model.gciSegments    ? packSegments(model.gciSegments)    : null;
  const transfers  = [...(entityPack?.transfers ?? []), ...(gciPack?.transfers ?? [])];

  const wire = {
    metadata:                 model.metadata,
    classes:                  [...model.classes.values()],
    objectProperties:         [...model.objectProperties.values()],
    dataProperties:           [...model.dataProperties.values()],
    annotationProperties:     [...model.annotationProperties.values()],
    individuals:              [...model.individuals.values()],
    sourceUri:                model.sourceUri,
    sourceFormat:             model.sourceFormat,
    standaloneGcis:           model.standaloneGcis,
    isClassified:             model.isClassified,
    classificationNeedsUpdate: model.classificationNeedsUpdate,
    closingParenLine:         model.closingParenLine ?? -1,
    gciInsertLine:            model.gciInsertLine    ?? -1,
    entitySegPack:            entityPack ? { iris: entityPack.iris, baseData: entityPack.baseData, liFlat: entityPack.liFlat, liOffsets: entityPack.liOffsets, lcsFlat: entityPack.lcsFlat, lcsOffsets: entityPack.lcsOffsets } : null,
    gciSegPack:               gciPack    ? { iris: gciPack.iris,    baseData: gciPack.baseData,    liFlat: gciPack.liFlat,    liOffsets: gciPack.liOffsets,    lcsFlat: gciPack.lcsFlat,    lcsOffsets: gciPack.lcsOffsets }    : null,
  };
  parentPort!.postMessage({ success: true, wire, timing }, transfers);
} catch (err) {
  parentPort!.postMessage({ success: false, error: err instanceof Error ? err.message : String(err) });
}
