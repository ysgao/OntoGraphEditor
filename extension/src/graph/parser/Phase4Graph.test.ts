import { readFileSync } from 'fs';
import { join } from 'path';
import { test, expect } from 'vitest';
import { TurtleParser } from './TurtleParser';
import { ManchesterParser } from './ManchesterParser';
import { serializeToFunctional } from '../serializer/FunctionalSerializer';

const ROOT = join(__dirname, '../../test-ontologies');

const OWL_THING = 'http://www.w3.org/2002/07/owl#Thing';
const MAX_NODES = 200;

type OntologyModel = ReturnType<TurtleParser['parse']>;

function buildGraphData(
  m: OntologyModel,
  focusIri: string | undefined,
  depth: number,
  opts: { showInferred: boolean; showDisjoint: boolean },
) {
  const assertedChildren = new Map<string, Set<string>>();
  for (const cls of m.classes.values()) {
    for (const sup of cls.superClassIris) {
      if (!assertedChildren.has(sup)) { assertedChildren.set(sup, new Set()); }
      assertedChildren.get(sup)!.add(cls.iri);
    }
  }

  let startIris: Set<string>;
  if (focusIri && m.classes.has(focusIri)) {
    startIris = new Set([focusIri]);
  } else {
    startIris = new Set(m.classes.keys());
  }

  const nodeIris = new Set<string>(startIris);
  const edgeMap = new Map<string, { source: string; target: string; type: string }>();

  const addEdge = (id: string, source: string, target: string, type: string) => {
    if (!edgeMap.has(id)) { edgeMap.set(id, { source, target, type }); }
  };

  let frontier = new Set<string>(startIris);
  for (let hop = 0; hop < depth && nodeIris.size < MAX_NODES; hop++) {
    const next = new Set<string>();
    for (const iri of frontier) {
      const cls = m.classes.get(iri);
      if (!cls) { continue; }
      for (const sup of cls.superClassIris) {
        if (sup === OWL_THING) { continue; }
        addEdge(`${iri}|sub|${sup}`, iri, sup, 'subClassOf');
        if (!nodeIris.has(sup)) { nodeIris.add(sup); next.add(sup); }
      }
      for (const sub of assertedChildren.get(iri) ?? []) {
        addEdge(`${sub}|sub|${iri}`, sub, iri, 'subClassOf');
        if (!nodeIris.has(sub)) { nodeIris.add(sub); next.add(sub); }
      }
      if (opts.showInferred && m.isClassified) {
        for (const infSub of m.inferredSubClasses.get(iri) ?? []) {
          if (!edgeMap.has(`${infSub}|sub|${iri}`)) {
            addEdge(`${infSub}|inf|${iri}`, infSub, iri, 'inferred');
          }
          if (!nodeIris.has(infSub)) { nodeIris.add(infSub); next.add(infSub); }
        }
      }
    }
    frontier = next;
    if (frontier.size === 0) { break; }
  }

  const nodeSet = new Set(nodeIris);
  const edges = [...edgeMap.values()].filter(e => nodeSet.has(e.source) && nodeSet.has(e.target));
  return { nodes: [...nodeIris], edges };
}

function loadModel() {
  const ttl = readFileSync(join(ROOT, 'animals.ttl'), 'utf8');
  const model = new TurtleParser(ttl, 'file:///animals.ttl').parse();
  model.inferredSubClasses.set('http://example.org/animals#Animal', new Set(['http://example.org/animals#Koala', 'http://example.org/animals#Vertebrate']));
  model.isClassified = true;
  return model;
}

// ── Verify FunctionalSerializer ───────────────────────────────────────────────

test('Phase4: FunctionalSerializer (animals.ttl)', () => {
  console.log('── FunctionalSerializer (animals.ttl) ────────────────────────────');
  const model = loadModel();
  const ofn = serializeToFunctional(model);

  expect(model.classes.size, `9 classes in model (got ${model.classes.size})`).toBe(9);
  expect(model.objectProperties.size, `3 object properties (got ${model.objectProperties.size})`).toBe(3);
  expect(model.individuals.size, `1 individual (got ${model.individuals.size})`).toBe(1);

  expect(ofn, 'Manchester → functional: has SubClassOf').toContain('SubClassOf(');
  expect(ofn, 'Manchester → functional: has DisjointClasses').toContain('DisjointClasses(');
});

// ── Graph neighbourhood extraction ────────────────────────────────────────────

test('Phase4: full graph extraction', () => {
  console.log('── Graph neighbourhood extraction ────────────────────────────────');
  const model = loadModel();
  const full = buildGraphData(model, undefined, 4, { showInferred: false, showDisjoint: false });
  expect(full.nodes.length, `Full graph: 9 class nodes (got ${full.nodes.length})`).toBe(9);
  const subClassEdges = full.edges.filter(e => e.type === 'subClassOf');
  expect(subClassEdges.length, `Full graph: >= 6 subClassOf edges (got ${subClassEdges.length})`).toBeGreaterThanOrEqual(6);
});

test('Phase4: focused graph on Koala depth=2', () => {
  const model = loadModel();
  const koalaIri = 'http://example.org/animals#Koala';
  const marsupialIri = 'http://example.org/animals#Marsupial';
  const mammalIri = 'http://example.org/animals#Mammal';

  const koalaView = buildGraphData(model, koalaIri, 2, { showInferred: false, showDisjoint: false });
  expect(koalaView.nodes, 'Focus=Koala: Koala in nodes').toContain(koalaIri);
  expect(koalaView.nodes, 'Focus=Koala depth=2: Marsupial in nodes (1 hop up)').toContain(marsupialIri);
  expect(koalaView.nodes, 'Focus=Koala depth=2: Mammal in nodes (2 hops up)').toContain(mammalIri);
  expect(koalaView.edges.some(e => e.source === koalaIri && e.target === marsupialIri && e.type === 'subClassOf'),
    'Focus=Koala: Koala→Marsupial subClassOf edge').toBe(true);
});

test('Phase4: inferred edges', () => {
  const model = loadModel();
  const inferredView = buildGraphData(model, 'http://example.org/animals#Animal', 1, { showInferred: true, showDisjoint: false });
  const inferredEdges = inferredView.edges.filter(e => e.type === 'inferred');
  expect(inferredEdges.some(e => e.source === 'http://example.org/animals#Koala' && e.target === 'http://example.org/animals#Animal'),
    `Inferred view: Koala→Animal inferred edge present (total inferred: ${inferredEdges.length})`).toBe(true);
});

test('Phase4: depth=1 from Vertebrate', () => {
  const model = loadModel();
  const mammalIri = 'http://example.org/animals#Mammal';
  const birdIri = 'http://example.org/animals#Bird';
  const vertView = buildGraphData(model, 'http://example.org/animals#Vertebrate', 1, { showInferred: false, showDisjoint: false });
  expect(vertView.nodes, 'Vertebrate depth=1: Mammal in nodes').toContain(mammalIri);
  expect(vertView.nodes, 'Vertebrate depth=1: Bird in nodes').toContain(birdIri);
});

// ── Manchester parser for graph use ──────────────────────────────────────────

test('Phase4: Manchester parser for graph use', () => {
  console.log('── Manchester parser for graph use ─────────────────────────────');
  const omn = readFileSync(join(ROOT, 'animals.omn'), 'utf8');
  const mnModel = new ManchesterParser(omn, 'file:///animals.omn').parse();
  const mnOfn = serializeToFunctional(mnModel);

  expect(mnModel.classes.size, `Manchester: >= 9 classes (got ${mnModel.classes.size})`).toBeGreaterThanOrEqual(9);
  expect(mnOfn, 'Manchester → functional: has SubClassOf').toContain('SubClassOf(');
  expect(mnOfn, 'Manchester → functional: has DisjointClasses').toContain('DisjointClasses(');
});
