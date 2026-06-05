import { createEmptyModel, OntologyModel, OWLClass, OWLObjectProperty, OWLDataProperty, OWLAnnotationProperty, OWLIndividual } from '../model/OntologyModel';

const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
const BUILTIN: [string, string][] = [
  ['owl:', 'http://www.w3.org/2002/07/owl#'],
  ['rdf:', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'],
  ['rdfs:', 'http://www.w3.org/2000/01/rdf-schema#'],
  ['xsd:', 'http://www.w3.org/2001/XMLSchema#'],
  ['xml:', 'http://www.w3.org/XML/1998/namespace'],
];
type TT = 'IRI' | 'WORD' | 'STRING' | 'INT' | 'COMMA' | 'LPAREN' | 'RPAREN' | 'COLON' | 'LBRACE' | 'RBRACE';
interface Tok { type: TT; value: string; lang?: string; datatype?: string; }

const FRAME_KW = new Set(['Class','ObjectProperty','DataProperty','AnnotationProperty','Individual','DisjointClasses','EquivalentClasses']);
const CLS_KW   = new Set(['Annotations','SubClassOf','EquivalentTo','DisjointWith']);
const PROP_KW  = new Set(['Annotations','SubPropertyOf','Domain','Range','Characteristics','InverseOf','EquivalentTo','DisjointWith','SubPropertyChain']);
const REST_KW  = new Set(['some','only','value','min','max','exactly','Self']);

function tokenize(src: string, pfx: Map<string, string>): Tok[] {
  const out: Tok[] = [];
  let i = 0; const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c <= ' ') { i++; continue; }
    if (c === '#') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '(') { out.push({ type:'LPAREN', value:'(' }); i++; continue; }
    if (c === ')') { out.push({ type:'RPAREN', value:')' }); i++; continue; }
    if (c === '{') { out.push({ type:'LBRACE', value:'{' }); i++; continue; }
    if (c === '}') { out.push({ type:'RBRACE', value:'}' }); i++; continue; }
    if (c === ',') { out.push({ type:'COMMA',  value:',' }); i++; continue; }
    if (c === ':') { out.push({ type:'COLON',  value:':' }); i++; continue; }
    if (c === '<') {
      const s = ++i; while (i < n && src[i] !== '>') i++;
      out.push({ type:'IRI', value: src.slice(s, i++) }); continue;
    }
    if (c === '"') {
      i++; const s = i;
      while (i < n) { if (src[i]==='\\'){i+=2;continue;} if(src[i]==='"'){i++;break;} i++; }
      const raw = src.slice(s, i-1).replace(/\\"/g,'"').replace(/\\n/g,'\n').replace(/\\t/g,'\t').replace(/\\\\/g,'\\');
      let lang: string|undefined, datatype: string|undefined;
      if (i < n && src[i] === '@') { const ls=++i; while(i<n&&/[A-Za-z0-9\-]/.test(src[i]))i++; lang=src.slice(ls,i); }
      else if (i+1<n && src[i]==='^' && src[i+1]==='^') {
        i+=2;
        if (src[i]==='<'){const ds=++i;while(i<n&&src[i]!=='>')i++;datatype=src.slice(ds,i++);}
        else{const ds=i;while(i<n&&src[i]>' '&&src[i]!==','&&src[i]!==')')i++;datatype=src.slice(ds,i);}
      }
      out.push({ type:'STRING', value:raw, lang, datatype }); continue;
    }
    if (c >= '0' && c <= '9') {
      const s=i; while(i<n&&src[i]>='0'&&src[i]<='9')i++;
      out.push({ type:'INT', value:src.slice(s,i) }); continue;
    }
    const s=i;
    while(i<n&&src[i]>' '&&!'(),{}:<>"'.includes(src[i]))i++;
    if(i>s){
      const word=src.slice(s,i);
      if(i<n && src[i]===':'){
        const a=src[i+1];
        if(a!==undefined&&a!==' '&&a!=='\t'&&a!=='\n'&&a!=='\r'&&a!=='<'&&a!=='>'){
          i++;
          const ls=i; while(i<n&&src[i]>' '&&!'(),{}:<>"'.includes(src[i]))i++;
          const local=src.slice(ls,i);
          const base=pfx.get(word+':');
          out.push({ type:'IRI', value: base!==undefined ? base+local : word+':'+local }); continue;
        }
      }
      out.push({ type:'WORD', value:word });
    }
  }
  return out;
}

export class ManchesterParser {
  private toks: Tok[] = [];
  private pos = 0;
  private pfx = new Map<string, string>(BUILTIN);
  private model: OntologyModel;
  private src: string;

  constructor(text: string, sourceUri: string) { this.src = text; this.model = createEmptyModel(sourceUri); }

  parse(): OntologyModel {
    this.pfx = new Map<string, string>(BUILTIN);
    const raw = tokenize(this.src, this.pfx);
    // First pass: extract prefix declarations so the full tokenization uses them
    let i = 0;
    while (i < raw.length) {
      const t = raw[i];
      if (t.type==='WORD' && t.value==='Prefix' && i+1<raw.length) {
        i++;
        if(raw[i]?.type==='COLON') i++;   // eat the ':' in 'Prefix:'
        let key='';
        if(raw[i]?.type==='WORD'){key=raw[i].value+':';i++;if(raw[i]?.type==='COLON')i++;}
        else if(raw[i]?.type==='COLON'){key=':';i++;}
        if(raw[i]?.type==='IRI'){this.pfx.set(key,raw[i].value);i++;}
      } else i++;
    }
    this.toks = tokenize(this.src, this.pfx);
    this.pos = 0;
    while (this.pos < this.toks.length) {
      const t = this.peek();
      if (!t) break;
      if (t.type==='WORD' && t.value==='Prefix') { this.parsePrefix(); continue; }
      if (t.type==='WORD' && t.value==='Ontology') { this.parseOntologyHeader(); continue; }
      if (t.type==='WORD' && FRAME_KW.has(t.value)) { this.parseFrame(); continue; }
      this.advance();
    }
    return this.model;
  }

  private peek(o=0): Tok|undefined { return this.toks[this.pos+o]; }
  private advance(): Tok { return this.toks[this.pos++] ?? { type:'WORD', value:'' }; }
  private eat(type: TT, value?: string): boolean {
    const t=this.peek();
    if(t&&t.type===type&&(value===undefined||t.value===value)){this.advance();return true;} return false;
  }

  private readIri(): string|null {
    const t=this.peek();
    if(!t) return null;
    if(t.type==='IRI'){this.advance();return t.value;}
    if(t.type==='COLON'){
      this.advance();
      const nx=this.peek();
      if(nx&&(nx.type==='WORD'||nx.type==='IRI')){this.advance();return (this.pfx.get(':')??':')+nx.value;}
    }
    return null;
  }

  private skipToNextFrame(): void {
    while(this.pos<this.toks.length){
      const t=this.peek();
      if(t?.type==='WORD'&&(FRAME_KW.has(t.value)||t.value==='Prefix'||t.value==='Ontology'))break;
      this.advance();
    }
  }

  private parsePrefix(): void {
    this.advance();          // skip 'Prefix'
    this.eat('COLON');       // eat the ':' in 'Prefix:'
    const t=this.peek(); let key='';
    if(t?.type==='WORD'){key=t.value+':';this.advance();this.eat('COLON');}
    else if(t?.type==='COLON'){key=':';this.advance();}
    const ir=this.peek();
    if(ir?.type==='IRI'){this.pfx.set(key,ir.value);this.advance();}
  }

  private parseOntologyHeader(): void {
    this.advance(); this.eat('COLON');
    if(this.peek()?.type==='IRI') this.model.metadata.iri=this.advance().value;
    if(this.peek()?.type==='IRI') this.model.metadata.versionIri=this.advance().value;
    while(this.pos<this.toks.length){
      const t=this.peek();
      if(!t||(t.type==='WORD'&&FRAME_KW.has(t.value)))break;
      if(t.type==='WORD'&&t.value==='Import'){
        this.advance();this.eat('COLON');
        if(this.peek()?.type==='IRI')this.model.metadata.imports.push(this.advance().value);
      } else if(t.type==='WORD'&&t.value==='Annotations'){
        this.advance();this.eat('COLON');
        this.parseAnnotationList(this.model.metadata.annotations,null);
      } else this.advance();
    }
  }

  private parseFrame(): void {
    const kw=this.peek();
    if(!kw)return;
    try {
      if(kw.value==='Class')                this.parseClassFrame();
      else if(kw.value==='ObjectProperty')  this.parseObjectPropertyFrame();
      else if(kw.value==='DataProperty')    this.parseDataPropertyFrame();
      else if(kw.value==='AnnotationProperty') this.parseAnnotationPropertyFrame();
      else if(kw.value==='Individual')      this.parseIndividualFrame();
      else if(kw.value==='DisjointClasses') this.parseGlobalClassList('disjoint');
      else if(kw.value==='EquivalentClasses') this.parseGlobalClassList('equivalent');
      else this.advance();
    } catch(e){ console.warn('[ManchesterParser]',e); this.skipToNextFrame(); }
  }

  private parseAnnotationList(store: Record<string,string[]>, labels: Record<string,string[]>|null): void {
    while(true){
      const propIri=this.readIri(); if(!propIri)break;
      const v=this.peek(); if(!v)break;
      if(v.type==='STRING'){
        this.advance();
        if(propIri===RDFS_LABEL&&labels)(labels[v.lang??'']??=[]).push(v.value);
        (store[propIri]??=[]).push(v.lang?`${v.value}@${v.lang}`:v.value);
      } else if(v.type==='IRI'||v.type==='WORD'){
        this.advance();(store[propIri]??=[]).push(v.value);
      }
      if(!this.eat('COMMA'))break;
    }
  }

  private mkClass(iri: string): OWLClass {
    let e=this.model.classes.get(iri);
    if(!e){e={iri,type:'class',labels:{},annotations:{},superClassIris:[],equivalentClassIris:[],disjointClassIris:[],superClassExpressions:[],equivalentClassExpressions:[],gciExpressions:[]};this.model.classes.set(iri,e);}
    return e;
  }
  private mkObjProp(iri: string): OWLObjectProperty {
    let e=this.model.objectProperties.get(iri);
    if(!e){e={iri,type:'objectProperty',labels:{},annotations:{},superPropertyIris:[],domainIris:[],rangeIris:[]};this.model.objectProperties.set(iri,e);}
    return e;
  }
  private mkDataProp(iri: string): OWLDataProperty {
    let e=this.model.dataProperties.get(iri);
    if(!e){e={iri,type:'dataProperty',labels:{},annotations:{},superPropertyIris:[],domainIris:[],rangeIris:[]};this.model.dataProperties.set(iri,e);}
    return e;
  }
  private mkAnnoProp(iri: string): OWLAnnotationProperty {
    let e=this.model.annotationProperties.get(iri);
    if(!e){e={iri,type:'annotationProperty',labels:{},annotations:{},superPropertyIris:[],domainIris:[],rangeIris:[]};this.model.annotationProperties.set(iri,e);}
    return e;
  }
  private mkIndividual(iri: string): OWLIndividual {
    let e=this.model.individuals.get(iri);
    if(!e){e={iri,type:'individual',labels:{},annotations:{},classIris:[],objectPropertyAssertions:[],dataPropertyAssertions:[]};this.model.individuals.set(iri,e);}
    return e;
  }

  private parseClassFrame(): void {
    this.advance(); this.eat('COLON');
    const iri=this.readIri(); if(!iri){this.skipToNextFrame();return;}
    const cls=this.mkClass(iri);
    while(this.pos<this.toks.length){
      const t=this.peek();
      if(!t||(t.type==='WORD'&&(FRAME_KW.has(t.value)||t.value==='Prefix'||t.value==='Ontology')))break;
      if(t.type!=='WORD'||!CLS_KW.has(t.value)){this.advance();continue;}
      const sec=t.value; this.advance(); this.eat('COLON');
      if(sec==='Annotations') this.parseAnnotationList(cls.annotations,cls.labels);
      else if(sec==='SubClassOf')  this.parseClassExprList(cls.superClassIris,cls.superClassExpressions);
      else if(sec==='EquivalentTo') this.parseClassExprList(cls.equivalentClassIris,cls.equivalentClassExpressions);
      else if(sec==='DisjointWith') this.parseClassExprList(cls.disjointClassIris,[]);
    }
  }

  private parseClassExprList(named: string[], exprs: string[]): void {
    while(true){
      const r=this.parseClassExpr();
      if(r.iri)named.push(r.iri); else if(r.str)exprs.push(r.str);
      if(!this.eat('COMMA'))break;
    }
  }

  private parseObjectPropertyFrame(): void {
    this.advance(); this.eat('COLON');
    const iri=this.readIri(); if(!iri){this.skipToNextFrame();return;}
    const p=this.mkObjProp(iri);
    while(this.pos<this.toks.length){
      const t=this.peek();
      if(!t||(t.type==='WORD'&&(FRAME_KW.has(t.value)||t.value==='Prefix'||t.value==='Ontology')))break;
      if(t.type!=='WORD'||!PROP_KW.has(t.value)){this.advance();continue;}
      const sec=t.value; this.advance(); this.eat('COLON');
      if(sec==='Annotations')  this.parseAnnotationList(p.annotations,p.labels);
      else if(sec==='SubPropertyOf'){const r=this.readIri();if(r)p.superPropertyIris.push(r);}
      else if(sec==='Domain'){const r=this.readIri();if(r)p.domainIris.push(r);}
      else if(sec==='Range'){const r=this.readIri();if(r)p.rangeIris.push(r);}
      else if(sec==='InverseOf'){const r=this.readIri();if(r)p.inverseOfIri=r;}
      else if(sec==='Characteristics') this.parseCharacteristics(p,true);
      else if(sec==='EquivalentTo'){const r=this.readIri();if(r){if(!p.equivalentPropertyIris)p.equivalentPropertyIris=[];p.equivalentPropertyIris.push(r);}}
      else if(sec==='DisjointWith'){const r=this.readIri();if(r){if(!p.disjointPropertyIris)p.disjointPropertyIris=[];p.disjointPropertyIris.push(r);}}
      else if(sec==='SubPropertyChain'){const chain=this.readPropertyChain();if(chain.length>=2){if(!p.propertyChains)p.propertyChains=[];p.propertyChains.push(chain);}}
    }
  }

  private parseDataPropertyFrame(): void {
    this.advance(); this.eat('COLON');
    const iri=this.readIri(); if(!iri){this.skipToNextFrame();return;}
    const p=this.mkDataProp(iri);
    while(this.pos<this.toks.length){
      const t=this.peek();
      if(!t||(t.type==='WORD'&&(FRAME_KW.has(t.value)||t.value==='Prefix'||t.value==='Ontology')))break;
      if(t.type!=='WORD'||!PROP_KW.has(t.value)){this.advance();continue;}
      const sec=t.value; this.advance(); this.eat('COLON');
      if(sec==='Annotations')  this.parseAnnotationList(p.annotations,p.labels);
      else if(sec==='SubPropertyOf'){const r=this.readIri();if(r)p.superPropertyIris.push(r);}
      else if(sec==='Domain'){const r=this.readIri();if(r)p.domainIris.push(r);}
      else if(sec==='Range'){const r=this.readIri();if(r)p.rangeIris.push(r);}
      else if(sec==='Characteristics') this.parseCharacteristics(p,false);
    }
  }

  private parseAnnotationPropertyFrame(): void {
    this.advance(); this.eat('COLON');
    const iri=this.readIri(); if(!iri){this.skipToNextFrame();return;}
    const p=this.mkAnnoProp(iri);
    while(this.pos<this.toks.length){
      const t=this.peek();
      if(!t||(t.type==='WORD'&&(FRAME_KW.has(t.value)||t.value==='Prefix'||t.value==='Ontology')))break;
      if(t.type!=='WORD'||!PROP_KW.has(t.value)){this.advance();continue;}
      const sec=t.value; this.advance(); this.eat('COLON');
      if(sec==='Annotations')  this.parseAnnotationList(p.annotations,p.labels);
      else if(sec==='SubPropertyOf'){const r=this.readIri();if(r)p.superPropertyIris.push(r);}
      else if(sec==='Domain'){const r=this.readIri();if(r)p.domainIris.push(r);}
      else if(sec==='Range'){const r=this.readIri();if(r)p.rangeIris.push(r);}
    }
  }

  private parseCharacteristics(p: {isFunctional?:boolean;isTransitive?:boolean;isSymmetric?:boolean}, allowInverse: boolean): void {
    while(true){
      const t=this.peek(); if(!t||t.type!=='WORD')break;
      if(t.value==='Functional'){p.isFunctional=true;this.advance();}
      else if(t.value==='Transitive'){p.isTransitive=true;this.advance();}
      else if(t.value==='Symmetric'){p.isSymmetric=true;this.advance();}
      else if(t.value==='InverseFunctional'){if(allowInverse)(p as OWLObjectProperty).isInverseFunctional=true;this.advance();}
      else if(t.value==='Asymmetric'){if(allowInverse)(p as OWLObjectProperty).isAsymmetric=true;this.advance();}
      else if(t.value==='Reflexive'){if(allowInverse)(p as OWLObjectProperty).isReflexive=true;this.advance();}
      else if(t.value==='Irreflexive'){if(allowInverse)(p as OWLObjectProperty).isIrreflexive=true;this.advance();}
      else break;
      if(!this.eat('COMMA'))break;
    }
  }

  private readPropertyChain(): string[] {
    const chain: string[] = [];
    const first = this.readIri();
    if(first) chain.push(first);
    while(this.peek()?.type==='WORD'&&this.peek()?.value==='o'){
      this.advance();
      const r=this.readIri();
      if(r) chain.push(r);
    }
    return chain;
  }

  private parseIndividualFrame(): void {
    this.advance(); this.eat('COLON');
    const iri=this.readIri(); if(!iri){this.skipToNextFrame();return;}
    const ind=this.mkIndividual(iri);
    const IND_KW=new Set(['Annotations','Types','Facts','SameAs','DifferentFrom']);
    while(this.pos<this.toks.length){
      const t=this.peek();
      if(!t||(t.type==='WORD'&&(FRAME_KW.has(t.value)||t.value==='Prefix'||t.value==='Ontology')))break;
      if(t.type!=='WORD'||!IND_KW.has(t.value)){this.advance();continue;}
      const sec=t.value; this.advance(); this.eat('COLON');
      if(sec==='Annotations') this.parseAnnotationList(ind.annotations,ind.labels);
      else if(sec==='Types'){
        while(true){const r=this.readIri();if(r)ind.classIris.push(r);if(!this.eat('COMMA'))break;}
      } else if(sec==='Facts'){
        while(true){
          const propIri=this.readIri(); if(!propIri)break;
          const v=this.peek(); if(!v)break;
          if(v.type==='IRI'){ind.objectPropertyAssertions.push({propertyIri:propIri,targetIri:v.value});this.advance();}
          else if(v.type==='STRING'){ind.dataPropertyAssertions.push({propertyIri:propIri,value:v.value,datatype:v.datatype});this.advance();}
          if(!this.eat('COMMA'))break;
        }
      }
    }
  }

  private parseGlobalClassList(mode: 'disjoint'|'equivalent'): void {
    this.advance(); this.eat('COLON');
    const iris: string[]=[];
    while(true){const r=this.readIri();if(r)iris.push(r);if(!this.eat('COMMA'))break;}
    for(const iri of iris){
      const cls=this.mkClass(iri);
      for(const other of iris){
        if(other===iri)continue;
        if(mode==='disjoint'&&!cls.disjointClassIris.includes(other))cls.disjointClassIris.push(other);
        if(mode==='equivalent'&&!cls.equivalentClassIris.includes(other))cls.equivalentClassIris.push(other);
      }
    }
  }

  private parseClassExpr(): {iri:string|null;str:string} { return this.parseDisjunction(); }

  private parseDisjunction(): {iri:string|null;str:string} {
    let l=this.parseConjunction();
    while(this.peek()?.value==='or'){this.advance();const r=this.parseConjunction();l={iri:null,str:`${l.str} or ${r.str}`};}
    return l;
  }

  private parseConjunction(): {iri:string|null;str:string} {
    let l=this.parsePrimary();
    while(this.peek()?.value==='and'){this.advance();const r=this.parsePrimary();l={iri:null,str:`${l.str} and ${r.str}`};}
    return l;
  }

  private parsePrimary(): {iri:string|null;str:string} {
    const t=this.peek(); if(!t)return{iri:null,str:''};
    if(t.type==='WORD'&&t.value==='not'){this.advance();const i=this.parsePrimary();return{iri:null,str:`not ${i.str}`};}
    if(t.type==='LPAREN'){this.advance();const i=this.parseDisjunction();this.eat('RPAREN');return{iri:null,str:`(${i.str})`};}
    if(t.type==='LBRACE'){
      this.advance();const parts:string[]=[];
      while(!this.eat('RBRACE')){const r=this.readIri();if(r)parts.push(r);else this.advance();this.eat('COMMA');}
      return{iri:null,str:`{${parts.join(', ')}}`};
    }
    if(t.type==='IRI'||t.type==='COLON'){
      const prop=this.readIri();
      if(!prop){this.advance();return{iri:null,str:''};}
      const nx=this.peek();
      if(nx?.type==='WORD'&&REST_KW.has(nx.value)){
        const op=nx.value;this.advance();
        if(op==='Self')return{iri:null,str:`${prop} Self`};
        if(op==='min'||op==='max'||op==='exactly'){
          const n=this.peek()?.type==='INT'?this.advance().value:'0';
          const f=(this.peek()?.type==='IRI'||this.peek()?.type==='COLON')?this.readIri():null;
          return{iri:null,str:f?`${prop} ${op} ${n} ${f}`:`${prop} ${op} ${n}`};
        }
        const f=this.parsePrimary();return{iri:null,str:`${prop} ${op} ${f.str}`};
      }
      return{iri:prop,str:prop};
    }
    this.advance();return{iri:null,str:''};
  }
}
