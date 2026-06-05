/*
 * OWL 2 Manchester Syntax — Class Expression & Related Grammar
 *
 * Start rules: ClassExpression, ClassExpressionList, ObjectPropertyExpressionList,
 *              SubPropertyChain, DataRange, Fact, IndividualIRIList
 */

// ===== Entry Points =====

ClassExpression
  = _ e:Disjunction _ { return e; }

ClassExpressionList
  = _ head:Disjunction tail:(_ "," _ Disjunction)* _ {
      return [head].concat(tail.map(function(t) { return t[3]; }));
    }

ObjectPropertyExpressionList
  = _ head:OPE tail:(_ "," _ OPE)* _ {
      return [head].concat(tail.map(function(t) { return t[3]; }));
    }

SubPropertyChain
  = _ head:OPE tail:(_ "o" ![a-zA-Z0-9_-] _ OPE)+ _ {
      return [head].concat(tail.map(function(t) { return t[4]; }));
    }

DataRange
  = _ r:DataDisjunction _ { return r; }

Fact
  = _ "not" ![a-zA-Z0-9_] _ prop:IRI _ val:Literal _ {
      return { negative: true, property: prop, literal: val };
    }
  / _ "not" ![a-zA-Z0-9_] _ prop:IRI _ ind:IRI _ {
      return { negative: true, property: prop, individual: ind };
    }
  / _ prop:IRI _ val:Literal _ {
      return { negative: false, property: prop, literal: val };
    }
  / _ prop:IRI _ ind:IRI _ {
      return { negative: false, property: prop, individual: ind };
    }

IndividualIRIList
  = _ head:IRI tail:(_ "," _ IRI)* _ {
      return [head].concat(tail.map(function(t) { return t[3]; }));
    }

// ===== Class Expressions =====

Disjunction
  = head:Conjunction tail:(_ "or" ![a-zA-Z0-9_] _ Conjunction)* {
      if (tail.length === 0) return head;
      return tail.reduce(function(acc, t) { return acc + " or " + t[4]; }, head);
    }

Conjunction
  = head:Negation tail:(_ "and" ![a-zA-Z0-9_] _ Negation)* {
      if (tail.length === 0) return head;
      return tail.reduce(function(acc, t) { return acc + " and " + t[4]; }, head);
    }

Negation
  = "not" ![a-zA-Z0-9_] _ e:Primary { return "not " + e; }
  / Primary

Primary
  = "(" _ e:Disjunction _ ")" { return "(" + e + ")"; }
  / Enumeration
  / Restriction
  / DatatypeRestriction
  / IRI

Enumeration
  = "{" _ head:IRI tail:(_ "," _ IRI)* _ "}" {
      return "{" + [head].concat(tail.map(function(t) { return t[3]; })).join(", ") + "}";
    }

Restriction
  = prop:OPE _ "Self" ![a-zA-Z0-9_] {
      return prop + " Self";
    }
  / prop:OPE _ op:RestOp _ filler:Primary {
      return prop + " " + op + " " + filler;
    }
  / prop:OPE _ "value" ![a-zA-Z0-9_] _ val:Literal {
      return prop + " value " + val.str;
    }
  / prop:OPE _ "value" ![a-zA-Z0-9_] _ ind:IRI {
      return prop + " value " + ind;
    }
  / prop:OPE _ op:CardOp _ n:NonNegativeInteger _ filler:Primary {
      return prop + " " + op + " " + n + " " + filler;
    }
  / prop:OPE _ op:CardOp _ n:NonNegativeInteger {
      return prop + " " + op + " " + n;
    }

OPE
  = "inverse" ![a-zA-Z0-9_] _ "(" _ p:IRI _ ")" { return "inverse(" + p + ")"; }
  / IRI

RestOp
  = op:("some" / "only") ![a-zA-Z0-9_] { return op; }

CardOp
  = op:("min" / "max" / "exactly") ![a-zA-Z0-9_] { return op; }

// ===== Data Ranges =====

DataDisjunction
  = head:DataConjunction tail:(_ "or" ![a-zA-Z0-9_] _ DataConjunction)* {
      if (tail.length === 0) return head;
      return tail.reduce(function(acc, t) { return acc + " or " + t[4]; }, head);
    }

DataConjunction
  = head:DataNegation tail:(_ "and" ![a-zA-Z0-9_] _ DataNegation)* {
      if (tail.length === 0) return head;
      return tail.reduce(function(acc, t) { return acc + " and " + t[4]; }, head);
    }

DataNegation
  = "not" ![a-zA-Z0-9_] _ e:DataPrimary { return "not " + e; }
  / DataPrimary

DataPrimary
  = DataEnumeration
  / DatatypeRestriction
  / IRI

DataEnumeration
  = "{" _ head:Literal tail:(_ "," _ Literal)* _ "}" {
      var lits = [head].concat(tail.map(function(t) { return t[3]; }));
      return "{" + lits.map(function(l) { return l.str; }).join(", ") + "}";
    }

DatatypeRestriction
  = dt:IRI _ "[" _ head:Facet tail:(_ "," _ Facet)* _ "]" {
      var facets = [head].concat(tail.map(function(t) { return t[3]; }));
      return dt + "[" + facets.join(", ") + "]";
    }

Facet
  = name:IRI _ val:Literal { return name + " " + val.str; }

// ===== Literals =====

Literal
  = str:QuotedString "@" lang:LanguageTag {
      return { str: '"' + str + '"@' + lang, lang: lang };
    }
  / str:QuotedString "^^" dt:IRI {
      return { str: '"' + str + '"^^' + dt, datatype: dt };
    }
  / str:QuotedString {
      return { str: '"' + str + '"' };
    }
  / n:DecimalLiteral {
      return { str: n };
    }
  / n:IntegerLiteral {
      return { str: n };
    }

QuotedString
  = '"' chars:StrChar* '"' { return chars.join(""); }

StrChar
  = "\\" c:. { return "\\" + c; }
  / [^"\\]

LanguageTag
  = $([a-zA-Z]+ ("-" [a-zA-Z0-9]+)*)

IntegerLiteral
  = $([+-]? [0-9]+)

DecimalLiteral
  = $([+-]? [0-9]* "." [0-9]+)

NonNegativeInteger
  = $([0-9]+)

// ===== IRIs =====

IRI
  = "<" chars:[^>]* ">" { return chars.join(""); }
  / PrefixedName

PrefixedName
  = prefix:PNPrefix ":" local:PNLocal { return prefix + ":" + local; }
  / ":" local:PNLocal { return ":" + local; }

PNPrefix
  = $(PNCharsBase PNChars*)

PNCharsBase
  = [a-zA-Z]
  / [À-ÖØ-öø-˿]
  / [Ͱ-ͽͿ-῿]
  / [‌-‍⁰-↏]
  / [Ⰰ-⿯、-퟿]
  / [豈-﷏ﷰ-�]

PNChars
  = PNCharsBase / [-0-9·]
  / [̀-ͯ‿-⁀]

PNLocal
  = $(PNLocalStart PNLocalChar*)

PNLocalStart
  = PNCharsBase / [0-9_]

PNLocalChar
  = PNChars / [_./]

// ===== Whitespace =====

_
  = ([ \t\r\n] / Comment)*

Comment
  = "#" [^\n]* "\n"?
