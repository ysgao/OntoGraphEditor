import { Worker } from 'worker_threads';
import * as path from 'path';
import type {
  OntologyModel, EntitySegment,
  OWLClass, OWLObjectProperty, OWLDataProperty, OWLAnnotationProperty, OWLIndividual,
} from '../model/OntologyModel';
import { FunctionalParser } from './FunctionalParser';
import { ManchesterParser } from './ManchesterParser';
import { TurtleParser } from './TurtleParser';
import { OwlXmlParser } from './OwlXmlParser';
import { RdfXmlParser } from './RdfXmlParser';

// ── Wire protocol: compact, transferable form sent from parserWorker → main ────
//
// Maps are flattened to arrays so V8's structured-clone skips Map-entry overhead.
// EntitySegment collections are packed into flat Int32Arrays and transferred
// (zero-copy) rather than cloned, eliminating the per-object serialisation cost
// of 100k+ EntitySegment wrappers.

interface WireSegmentPack {
  iris: string[];
  /** [startLine, endLine, startChar, endChar] × iris.length */
  baseData: Int32Array;
  /** All lineIndices values concatenated. */
  liFlat: Int32Array;
  /** liFlat[liOffsets[i]..liOffsets[i+1]) = lineIndices for iris[i]. Length = iris.length+1. */
  liOffsets: Int32Array;
  lcsFlat: Int32Array;
  lcsOffsets: Int32Array;
}

interface WireModel {
  metadata: OntologyModel['metadata'];
  classes: OWLClass[];
  objectProperties: OWLObjectProperty[];
  dataProperties: OWLDataProperty[];
  annotationProperties: OWLAnnotationProperty[];
  individuals: OWLIndividual[];
  sourceUri: string;
  sourceFormat: string;
  standaloneGcis: string[];
  isClassified: boolean;
  classificationNeedsUpdate: boolean;
  closingParenLine: number;
  gciInsertLine: number;
  entitySegPack: WireSegmentPack | null;
  gciSegPack: WireSegmentPack | null;
}

function unpackSegments(pack: WireSegmentPack): Map<string, EntitySegment> {
  const result = new Map<string, EntitySegment>();
  for (let i = 0; i < pack.iris.length; i++) {
    const liStart = pack.liOffsets[i], liEnd = pack.liOffsets[i + 1];
    const lcsStart = pack.lcsOffsets[i], lcsEnd = pack.lcsOffsets[i + 1];
    result.set(pack.iris[i], {
      startLine: pack.baseData[i * 4],
      endLine:   pack.baseData[i * 4 + 1],
      startChar: pack.baseData[i * 4 + 2],
      endChar:   pack.baseData[i * 4 + 3],
      lineIndices:    liEnd  > liStart  ? pack.liFlat.subarray(liStart, liEnd)    : undefined,
      lineCharStarts: lcsEnd > lcsStart ? pack.lcsFlat.subarray(lcsStart, lcsEnd) : undefined,
    });
  }
  return result;
}

export const LARGE_FILE_BYTES = 5 * 1024 * 1024;

function detectOwlFormat(text: string): 'functional' | 'manchester' | 'owlxml' | 'rdfxml' | 'turtle' | 'unknown' {
  const t = text.trimStart();
  if (t.startsWith('<')) {
    const head = t.slice(0, 2000);
    if (/<Ontology[\s>]/.test(head)) { return 'owlxml'; }
    if (/<rdf:RDF[\s>]/.test(head) || /xmlns:rdf=/.test(head)) { return 'rdfxml'; }
    return 'unknown';
  }
  if (t.slice(0, 16384).includes('Ontology(')) { return 'functional'; }
  if (t.slice(0, 16384).includes('Ontology:')) { return 'manchester'; }
  if (/(?:@prefix|@base|PREFIX\s|BASE\s)/.test(t.slice(0, 1024))) { return 'turtle'; }
  return 'unknown';
}

export class ParserRegistry {
  static parseAsync(text: string, languageId: string, uri: string): Promise<OntologyModel> {
    if (text.length <= LARGE_FILE_BYTES) {
      try {
        return Promise.resolve(ParserRegistry.parse(text, languageId, uri));
      } catch (err) {
        return Promise.reject(err instanceof Error ? err : new Error(String(err)));
      }
    }
    return new Promise<OntologyModel>((resolve, reject) => {
      const workerPath = path.join(__dirname, 'parserWorker.js');
      const tSpawn = Date.now();
      const worker = new Worker(workerPath, { workerData: { text, languageId, uri } });
      const tAfterSpawn = Date.now();
      console.log(`[perf:worker] spawn+workerData serialize: ${tAfterSpawn - tSpawn}ms`);
      worker.once('message', (msg: { success: boolean; wire?: WireModel; error?: string; timing?: { parse: number; index: number } }) => {
        const tRoundTrip = Date.now();
        if (msg.success && msg.wire) {
          const w = msg.wire;
          const model: OntologyModel = {
            metadata: w.metadata,
            classes: new Map(w.classes.map(c => [c.iri, c])),
            objectProperties: new Map(w.objectProperties.map(p => [p.iri, p])),
            dataProperties: new Map(w.dataProperties.map(p => [p.iri, p])),
            annotationProperties: new Map(w.annotationProperties.map(p => [p.iri, p])),
            individuals: new Map(w.individuals.map(i => [i.iri, i])),
            sourceUri: w.sourceUri,
            sourceFormat: w.sourceFormat,
            standaloneGcis: w.standaloneGcis,
            rawContent: text,
            isClassified: w.isClassified,
            classificationNeedsUpdate: w.classificationNeedsUpdate,
            closingParenLine: w.closingParenLine,
            gciInsertLine: w.gciInsertLine,
            entitySegments: w.entitySegPack ? unpackSegments(w.entitySegPack) : undefined,
            gciSegments: w.gciSegPack ? unpackSegments(w.gciSegPack) : undefined,
            inferredSubClasses: new Map(),
          };
          if (msg.timing) {
            const overhead = (tRoundTrip - tAfterSpawn) - msg.timing.parse - msg.timing.index;
            console.log(`[perf:worker] parse (FunctionalParser): ${msg.timing.parse}ms`);
            console.log(`[perf:worker] buildSegmentIndex: ${msg.timing.index}ms`);
            console.log(`[perf:worker] postMessage serialize+copy: ~${overhead}ms`);
            console.log(`[perf:worker] round-trip (post workerData): ${tRoundTrip - tAfterSpawn}ms`);
          }
          resolve(model);
        }
        else { reject(new Error(msg.error ?? 'Parser worker returned no model')); }
      });
      worker.once('error', reject);
      worker.once('exit', (code) => {
        if (code !== 0) { reject(new Error(`Parser worker exited with code ${code}`)); }
      });
    });
  }

  static parse(text: string, languageId: string, uri: string): OntologyModel {

    let model: OntologyModel;
    let sourceFormat: string;

    switch (languageId) {
      case 'owl-functional':
        model = new FunctionalParser(text, uri).parse();
        sourceFormat = 'functional';
        break;

      case 'manchester':
        model = new ManchesterParser(text, uri).parse();
        sourceFormat = 'manchester';
        break;

      case 'turtle':
        model = new TurtleParser(text, uri).parse();
        sourceFormat = 'turtle';
        break;

      case 'auto':
      case 'owl-xml': {
        const fmt = detectOwlFormat(text);
        if (fmt === 'functional') { model = new FunctionalParser(text, uri).parse();  sourceFormat = 'functional'; break; }
        if (fmt === 'owlxml')     { model = new OwlXmlParser(text, uri).parse();      sourceFormat = 'owl-xml';    break; }
        if (fmt === 'rdfxml')     { model = new RdfXmlParser(text, uri).parse();      sourceFormat = 'rdf-xml';    break; }
        if (fmt === 'manchester') { model = new ManchesterParser(text, uri).parse();  sourceFormat = 'manchester'; break; }
        if (fmt === 'turtle')     { model = new TurtleParser(text, uri).parse();      sourceFormat = 'turtle';     break; }
        throw new Error(`Could not detect OWL serialisation format for: ${uri}`);
      }

      default:
        throw new Error(`No parser registered for language: ${languageId}`);
    }

    model.rawContent = text;
    model.sourceFormat = sourceFormat;
    return model;
  }
}
