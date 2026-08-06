---
name: authoring-cli
description: >
  How to drive `authoring-cli`, the headless SNOMED CT authoring tool, correctly — concept
  creation, description/acceptability edits (especially the US/GB and other dialect
  spelling-variant pattern: edema/oedema, anemia/anaemia, hemoglobin/haemoglobin, tumor/tumour,
  leukocyte/leucocyte, etc.), relationship/axiom edits, classification, and batch/bulk concept
  generation. Use this whenever you're about to run `authoring-cli` to create or edit a concept —
  its descriptions, acceptability, relationships, or axioms — or to run `classify`/`validate-task`, or
  to generate a concept that's structurally parallel to an existing one (same axiom shape, one
  attribute swapped, across possibly hundreds of source concepts). Several of these operations have
  hard server-side constraints or async/caching quirks that fail or mislead in non-obvious ways if
  you don't know about them going in. Also use this if any `authoring-cli` command returns an HTTP
  400/409/500, or if a validation warning doesn't seem to match what you just saved.
---

# authoring-cli

`authoring-cli` performs SNOMED CT authoring actions against whatever task branch is open in the
OntoGraph Editor VS Code extension (or an explicit `--project`/`--task` pair). Run it with no
arguments to print the full, current command list — that list is the source of truth over
anything below; commands and flags get added over time and this file will lag.

```
authoring-cli
```

Every action needs task context. If no task is open in the extension, pass `--project <key>
--task <key>` explicitly on each call. `authoring-cli current-task` confirms which task the CLI
will actually target before you commit to a sequence of edits.

## Ground truth vs. echoed validation results

Every concept-mutating command (`create-concept`, `add-description`, `set-acceptability`, ...)
requests Snowstorm's `?validate=true` on save and prints whatever `validationResults` comes back
alongside the outcome. `validate-concept` runs the same check read-only, without saving anything.

Both of these can lag behind a write that just landed on the *same* concept moments earlier —
they've been observed printing a warning describing the pre-fix state for several seconds to tens
of seconds after the fix was actually saved. Don't take a validation warning that doesn't match
what you expect at face value: re-fetch with `get-concept` and compare its `acceptabilityMap`
values directly. `get-concept`'s response is the one thing that reflects exactly what's persisted
right now. If the warning still contradicts a fresh `get-concept`, then something is actually
wrong; if it matches an old state, it's just this lag and will clear on its own.

## The hard constraint you must design around

Snowstorm requires **exactly one PREFERRED synonym per language refset, at all times** — not a
soft warning, a blocking HTTP 400 on the save itself. Concretely, for a concept's en-us and en-gb
synonyms:

- Never zero PREFERRED synonyms in a given dialect.
- Never two PREFERRED synonyms in the same dialect.
- This is enforced *per save*, so it also rules out any sequence of saves that passes through an
  invalid state in between, even momentarily.

This matters the moment you need to move "preferred" from one description to another in the same
dialect — e.g. you created a concept with the wrong term preferred in en-gb and want to swap it for
a different synonym. Doing this as two separate `set-acceptability --description-id ...` calls
**fails no matter which order you pick**:

- Promote the new one to PREFERRED first → briefly two PREFERRED synonyms in that dialect → 400
  ("must not have more than one PT per language refset").
- Demote the old one first → briefly zero PREFERRED synonyms in that dialect → 400 ("must have one
  Preferred Synonym in the ... language refset").

Both halves get rejected independently and atomically — nothing partially saves, so you can't
corrupt the concept this way, but you also can't complete the swap this way at all.

**The fix: `set-acceptability --entries`.** Instead of one `--description-id`, pass a JSON array
covering every description that needs to change, and they all apply within the same save:

```
authoring-cli set-acceptability --id <SCTID> \
  --entries '[{"descriptionId":"<oldPreferredId>","gb":"ACCEPTABLE"},
              {"descriptionId":"<newPreferredId>","gb":"PREFERRED"}]' \
  --project <projectKey> --task <taskKey>
```

Reach for `--entries` by default whenever a fix touches more than one description's acceptability
on the same concept — not just for spelling variants, for *any* case where two descriptions need
to change together consistently. The plain single-description form (`--description-id <id>
[--lang ...] [--us ...] [--gb ...]`) is still correct and simpler, but only when the one change you
're making doesn't require any other description to move in the same save (e.g. bumping an
already-non-conflicting description from ACCEPTABLE to PREFERRED, or demoting a description that
isn't the dialect's sole PREFERRED one).

## US/GB (and other dialect) spelling-variant pairs

When a synonym contains a word that's spelled differently in US vs. GB English — edema/oedema,
anemia/anaemia, hemoglobin/haemoglobin, tumor/tumour, leukocyte/leucocyte, and others — model it as
**two separate synonym descriptions**, one per spelling. Don't put one term in both dialects.

### The rule

**A description whose term is a US-only spelling may only ever be a member of the en-us refset —
never en-gb, not even as ACCEPTABLE. A description whose term is a GB-only spelling may only ever
be a member of the en-gb refset — never en-us.** The refset membership itself asserts "this text is
valid in this dialect" — a US-only spelling isn't valid GB English at any acceptability level, so
it has no business being *in* that refset at all, preferred or not. This is a modeling rule about
the term's content, independent of the "exactly one PREFERRED" save-time constraint above: even if
en-gb already has a different PREFERRED synonym and adding this one as merely ACCEPTABLE wouldn't
trip that constraint, it's still wrong to add it there.

Consequence for the acceptabilityMap:

| Description        | en-us (900000000000509007) | en-gb (900000000000508004) |
|---------------------|------------------------------|------------------------------|
| US-spelled synonym  | PREFERRED                   | NOT_ACCEPTABLE (absent)     |
| GB-spelled synonym  | NOT_ACCEPTABLE (absent)     | PREFERRED                   |

(An intermediate "PREFERRED at home, ACCEPTABLE elsewhere" shape is *not* correct for a pure
spelling variant; that shape is for a genuinely different but valid synonym in both dialects, not
for two spellings of the same word.) The FSN is unaffected by any of this — it's a single fixed
term and stays PREFERRED in both dialects regardless.

The one invariant you can't violate on either description: an active description must be
PREFERRED-or-ACCEPTABLE in *at least one* dialect. `NOT_ACCEPTABLE` in every dialect at once is
rejected. That's never a concern here since each spelling variant keeps PREFERRED in its own home
dialect.

### Worked example

Adding "Edema of digit of hand" with its GB variant "Oedema of digit of hand", parented under
`102564009` (Edema of hand):

```
# 1. Create the concept. Pick either spelling for the FSN/PT — it doesn't matter which; Snowstorm's
#    own validate=true response will immediately warn that the PT is preferred in the "wrong"
#    dialect. That's expected at this point, not a sign create-concept did anything wrong.
authoring-cli create-concept --fsn "Edema of digit of hand" --parent 102564009 --tag finding \
  --pt "Edema of digit of hand" --project <projectKey> --task <taskKey>
# → Created concept <SCTID>

# 2. Fetch it to read the server-assigned descriptionId of the PT/synonym just created.
authoring-cli get-concept --id <SCTID> --project <projectKey> --task <taskKey>
# → descriptionId <edemaId>, acceptabilityMap {us: PREFERRED, gb: PREFERRED}

# 3. Add the other spelling as a new synonym. --acceptability applies ONE value uniformly to both
#    dialects at creation time, so this momentarily violates "the rule" above (a GB spelling
#    sitting in en-us too) — that's fine as a staging step ONLY because step 5 corrects it in the
#    very next save; don't stop here and leave it in this shape.
authoring-cli add-description --id <SCTID> --term "Oedema of digit of hand" --type SYNONYM \
  --acceptability ACCEPTABLE --project <projectKey> --task <taskKey>

# 4. Fetch again for the new synonym's descriptionId.
authoring-cli get-concept --id <SCTID> --project <projectKey> --task <taskKey>
# → descriptionId <oedemaId>, acceptabilityMap {us: ACCEPTABLE, gb: ACCEPTABLE}

# 5. One atomic save: move "preferred in en-gb" from the US spelling to the GB spelling, AND strip
#    each spelling's membership from the dialect it doesn't belong in. This one call both performs
#    the preferred-synonym swap (which per the hard constraint above MUST be atomic) and reaches
#    the correct target shape from the table.
authoring-cli set-acceptability --id <SCTID> \
  --entries '[{"descriptionId":"<edemaId>","gb":"NOT_ACCEPTABLE"},
              {"descriptionId":"<oedemaId>","us":"NOT_ACCEPTABLE","gb":"PREFERRED"}]' \
  --project <projectKey> --task <taskKey>

# 6. Confirm.
authoring-cli validate-concept --id <SCTID> --project <projectKey> --task <taskKey>
# → No validation issues for concept <SCTID>.
```

If step 6 still shows a spelling-variant warning, re-run `get-concept` and compare its
`acceptabilityMap` against the table above before assuming the fix didn't take — see "Ground truth
vs. echoed validation results" above.

## Editing relationships and axioms

`add-relationship --group N` doesn't reliably honor the requested *absolute* group number once a
concept needs **more than one non-zero relationship group** — e.g. "Due to" in group 2 alongside
"Finding site"/"Associated morphology" in group 1. The groups can get silently compacted together,
which changes the axiom's actual meaning (grouped attributes describe one nexus; separate groups
are independent qualifiers) — this is easy to author and validate without noticing, since nothing
rejects the save.

If the concept needs more than one non-zero group, skip `add-relationship` for those and build the
whole axiom in one call instead, with the exact `groupId`s you want:

```
authoring-cli update-axiom --id <SCTID> --axiom-id <axiomId> --relationships \
  '[{"active":true,"groupId":0,"type":{"conceptId":"116680003"},"target":{"conceptId":"..."}},
    {"active":true,"groupId":1,"type":{"conceptId":"363698007"},"target":{"conceptId":"..."}},
    {"active":true,"groupId":2,"type":{"conceptId":"42752001"},"target":{"conceptId":"..."}}]'
```

(Get `axiomId` from `get-concept` right after creating the concept.) Single-group concepts — the
common case — are unaffected; plain `add-relationship` is fine and simpler there.

### Removing a relationship — including from a published axiom

(`remove-relationship` is also callable as `delete-relationship` — same command, whichever verb
you reach for first.)

`update-axiom` and `remove-relationship` are gated at **different levels**, and that difference is
the whole story for editing an axiom that's already been released:

- `update-axiom` checks the **axiom's own** `effectiveTime`. If the axiom has ever been versioned
  (`released: true` with a real `effectiveTime`, not just inherited from the concept), every call
  fails with HTTP 409 — it replaces `relationships` wholesale, so it refuses outright rather than
  risk silently changing a released axiom's meaning.
- `remove-relationship` checks the **targeted relationship's own** `effectiveTime` only, never the
  axiom's. This mirrors the real Authoring Workbench: its "Remove Relationship" button re-saves the
  same axiom (same `axiomId`) with one relationship gone, regardless of whether that axiom has been
  released before — only the specific relationship being removed must itself never have been
  versioned.

So: **removing one relationship from a published axiom is `remove-relationship`, not
`update-axiom`.** Get the target's `relationshipId` (or its array index within that axiom) from
`get-concept`, then:

```
authoring-cli remove-relationship --id <SCTID> --axiom-id <axiomId> --relationship-id <relationshipId>
```

If that specific relationship has its own `effectiveTime` set (it was independently versioned —
uncommon, but possible for a relationship inside an otherwise-unversioned axiom edit history), the
call 409s and there's no way to remove it via the CLI; that's expected residue, same as the fully-
versioned-axiom case in "Redundant stated Is-a relationships" below.

### Removing an entire role group

(`remove-role-group` is also callable as `delete-role-group` or `delete-rolegroup`.)

Use `remove-role-group`, not a manual loop of `remove-relationship` calls. It identifies the target
group **by content, not by `groupId`** — pass `{typeId, targetId}` attribute pairs that identify
the group, not necessarily all of them:

```
authoring-cli remove-role-group --id <SCTID> --axiom-id <axiomId> --attributes \
  '[{"typeId":"363698007","targetId":"53505006"}]'
```

**Why content instead of `groupId`:** SNOMED CT's own model has no persistent "role group ID" —
`groupId` is just an internal number Snowstorm assigns per save to cluster relationships, and it's
already documented above as unreliable to target directly (`add-relationship --group N` silently
compacting groups together). The set of attribute/value pairs actually inside a group is the only
thing that names it consistently.

**`--attributes` only needs to *identify* the group, not enumerate it.** If one pair — say, Finding
site = X — occurs in only one role group of the axiom, that single pair is enough: the whole group
it belongs to is removed, including any other relationships in it you didn't mention (e.g. an
Associated morphology in the same group). You don't need to look up and list every relationship in
the group first. Get candidate pairs from `get-concept`'s `classAxioms[N].relationships[]` (each
entry's `type.conceptId`/`target.conceptId`, grouped by `groupId` just to see what's likely unique).

If the given pair(s) match **more than one** role group in the axiom, the call fails with HTTP 409
and lists every candidate `groupId` rather than guessing which one you meant — deleting the wrong
role group is not a recoverable mistake. From there you have two options:

- Add another attribute pair from the group you actually want (e.g. also include the Associated
  morphology pair) and retry — this re-narrows the match to one group.
- Or, if the groups are genuinely indistinguishable by content alone, pass `--group-id N` (one of
  the listed candidates) to target that specific one directly — the case-by-case fallback for when
  two role groups happen to share an attribute pair but aren't actually the same group.

Same axiom-publication rule as `remove-relationship`: **no axiom-level `effectiveTime` gate at
all** — a published axiom's group can be removed just like an unpublished one. The only gate is
per-relationship: if any relationship inside the matched group has its own `effectiveTime` set
(independently versioned), the whole call 409s and nothing is removed — deliberately no partial
removal, since a role group's members jointly describe one nexus and dropping only some of them
would change what the axiom asserts rather than just shrinking it.

Two more edges worth knowing: `groupId 0` (SNOMED's ungrouped bucket, which usually also holds the
stated `Is a`) is excluded from matching unless you explicitly pass `--group-id 0` — otherwise a
pair that happens to match an ungrouped attribute could sweep up unrelated ungrouped relationships,
including `Is a`, as collateral damage. And `remove-role-group` only targets `classAxioms`; a GCI
role group still needs the `update-gci-axiom` workaround (rewrite the relationships list with that
group's entries omitted), gated on the whole GCI axiom's own `effectiveTime` since there's no
per-relationship GCI removal endpoint.

Confirm with `authoring-cli validate-concept --id <SCTID>` afterward.

## Redundant stated Is-a relationships

Adding a new stated `Is a` (`116680003`) parent to a concept that already has a broader stated
parent — e.g. after minting a new intermediate concept and pointing an existing one at it as an
additional parent — commonly triggers: `Concept should not contain any redundantly stated IsA
relationships`, because the old, broader parent is now a direct or indirect ancestor of the new,
more specific one. Resolve it immediately rather than leaving it as residue:

1. `get-concept` and find the redundant `Is a` entry inside `classAxioms[0].relationships[]` (the
   warning names both the redundant parent and the more-specific one making it redundant — it's
   the `groupId: 0` `Is a` relationship whose `target` is the broader, redundant parent). Note its
   array index and the axiom's `axiomId`.
2. Check **that specific relationship's own `effectiveTime`/`released` flag** — not just the
   axiom-level one; see "Removing a relationship — including from a published axiom" above for why
   they're gated independently. An axiom can show `released: true` overall while an individual
   relationship inside it (e.g. the parent you just added this session) is still `released: false`.
   - That relationship's own `effectiveTime` is unset → `authoring-cli remove-relationship --id
     <id> --axiom-id <axiomId> --relationship-index <N>` removes just that one relationship
     cleanly, in one call, **regardless of whether the axiom itself has been released** — prefer
     this over rewriting the whole axiom.
   - Else (that specific relationship has itself been versioned) → also try `update-axiom` if the
     *whole axiom* has never been versioned (rewrite the full list with the redundant parent
     dropped); if the axiom is genuinely versioned too, both commands fail with HTTP 409. Leave both
     stated parents in place and accept the warning — a released/versioned relationship shouldn't be
     force-edited; this is expected residue for CLI-only authoring, resolved by a human in the
     interactive editor at the next release cycle, not a bug to work around.
3. Re-run `validate-concept --id <id>` to confirm the warning cleared.

## Generating a concept structurally parallel to an existing one

A common authoring task, especially at scale: mint a new concept whose defining axiom is identical
to an existing source concept's except for one substituted attribute value — a different
anatomical site, laterality, substance, or similar. (For a worked example of this pattern applied
across a large source list, see `references/batch-authoring.md`.)

1. Fetch the source's **real** defining axiom via `get-concept` — not a rendering or a note from an
   earlier session; it may have changed. Identify exactly which relationship(s) carry the attribute
   you're substituting (for a site swap: Finding site `363698007`, Procedure site `363704007`,
   Procedure site - Direct `405813007`, Procedure site - Indirect `405814001`). Copy everything else
   in the axiom — morphology, occurrence, method, due-to, the top-level `Is a` — verbatim.
2. Verify the substituted value's target concept already exists via a live `search-concepts` with
   an **exact** match check on the FSN, not a fuzzy hit and not a static/hardcoded mapping table —
   terminology content drifts and a stale local table will confidently point you at the wrong
   concept, or one that's been superseded. Not found → don't guess a new label; either recurse
   (fetch *that* value's own axiom and substitute one level further down) or treat it as genuinely
   out of scope (new content needs to be minted first, a separate, non-mechanical task).
3. **`definitionStatus` inheritance matters more than it looks.** Match the source: `FULLY_DEFINED`
   source → `FULLY_DEFINED` new concept, which gets the source auto-classified as a subtype with no
   manual retrofit needed. `PRIMITIVE` source → `PRIMITIVE` new concept, which needs the manual
   retrofit below — primitive-to-primitive subsumption never auto-infers.
4. If the new concept is `PRIMITIVE`, retrofit the source: `authoring-cli add-relationship --id
   <sourceId> --type 116680003 --target <newId> --group 0` adds the new concept as a further stated
   parent (not a replacement) on the original source. This commonly triggers the redundant-Is-a
   warning above — resolve it now, don't leave it for later.
5. Before minting anything, sanity-check that naive substitution actually holds:
   - **Compound words**: the substituted term might be glued into a single word in some contexts
     (e.g. "...nail" as one word), where substituting the phrase produces a nonsense concatenation.
   - **Idioms**: some source concepts are named clinical entities, not compositional references to
     their attribute value, even though that attribute happens to swap cleanly on paper — the
     substituted result may not be an attested or sensible concept at all.
   - **Cardinality**: a singular source concept doesn't necessarily have a coherent "multiple"
     counterpart, and a substituted value might not have the same cardinality as the original (e.g.
     a body part that exists exactly once, substituted in for one that exists in pairs).
   When any of these apply, that candidate needs a human/judgment call, not mechanical generation.

## Classification

`authoring-cli classify` is self-healing, not a plain "always start a new job" call: before
starting anything, it checks the branch's *current* classification state and reacts to what's
actually there —

- Already `RUNNING`/`BUILDING`/`SCHEDULED`/`QUEUED` → attaches to that job and waits on it, rather
  than starting a second one (this happens regardless of whether you passed `--wait` yourself —
  finding an unresolved job in progress means it needs resolving, not a fire-and-forget response
  about a different, about-to-be-started job).
- Already `COMPLETED` but not yet saved → skips starting entirely and accepts it immediately.
- `SAVED`/`STALE`/`SAVE_FAILED`/never run → nothing pending; starts a fresh job exactly as before
  (fire-and-forget unless you pass `--wait`).

This exists because the naive version — unconditionally POSTing to start on every call — silently
spawned a redundant second ELK run in practice: a completed-but-unsaved job does **not** block a
new start the way a genuinely running one does, so calling `classify` again to "check on" a job
that had already finished just started a *different* one instead, with no error to signal it.

`--wait` polls on a tightening schedule rather than a flat interval — the same schedule the
extension's own webview uses (`buildClassificationPollSchedule()` in both `classification.ts` and
`apps/authoring-ui-vscode/app/components/edit/edit.js`, deliberately kept in sync): skip the first
90s (classification normally finishes in ~2 minutes, so nothing checked that early is realistically
done), then check every 10s for 30s, then every 5s. That schedule sums to exactly 3 minutes, which
is `classify`'s new default `--timeout` too — down from a flat 600s. Once the schedule is
exhausted, polling keeps going at its final 5s interval until your own `--timeout` budget elapses,
so pass a larger one (e.g. `--timeout 1200`) for a known-large branch where a full-edition ELK run
genuinely takes 10-20+ minutes; the default of 180 is sized for the common case, not a hard ceiling.

For a pure status check with no side effects at all — no start, no accept, just "what's the
current job and status" — use `authoring-cli classification-status` instead. It's safe to call
anytime, including while you're unsure whether something is already running, and is the right tool
when you just want to look before deciding whether to call `classify` at all.

`classify --wait --timeout N` can report `Classification results NOT saved: Timed out waiting for
classification results to save` even when the results **were** actually saved — that message is
about the wait, not the outcome. After any `--wait` timeout, don't assume failure: `get-concept` on
one of the affected `FULLY_DEFINED` concepts and look in `relationships[]` for an entry with
`typeId == "116680003"` and `characteristicType == "INFERRED_RELATIONSHIP"` pointing at the concept
you expect. If it's there, classification saved fine regardless of what the CLI printed — or just
run `classification-status` to check the current job's status directly.

After classifying, spot-check bidirectionally: a new/changed concept's inferred descendants should
include whatever it was meant to subsume, and those concepts should show it among their own
inferred `Is a` parents.

## Task-level validation (`validate-task`)

Like `classify`, `validate-task` checks the task's current validation status before starting
anything — two validations running concurrently against the same task is pure waste, not a way to
get a faster result. If it finds one already `RUNNING`/`QUEUED`/`SCHEDULED`, it attaches to and
waits on that one instead of starting a second, **regardless of whether you passed `--wait`
yourself** — the same reasoning as `classify`'s handling of an already-running classification (see
above): finding an unresolved run in progress means it needs resolving, not a fire-and-forget
response about a different run you're about to start on top of it.

Task validation (RVF) routinely takes ~10 minutes or more — an order of magnitude longer than
classification's ~2 minutes — so `validate-task --wait` polls on its own, much longer backed-off
schedule rather than classification's: skip the first 5 minutes entirely, then check once a minute
for 5 minutes, then every 30s for 5 more (15 minutes total, also the new default `--timeout`, down
from a flat 600s at a flat 5s interval). Pass a larger `--timeout` if you know a given branch
routinely takes longer than that.

For checking on a long validation run without blocking a whole tool call for up to 15 minutes, use
`authoring-cli validation-status` instead — a pure read-only check (no start, no wait) that reports
the task's current `latestValidationStatus` directly. Prefer this over `--wait` when you have other
work to do in the meantime; call it again later rather than holding a blocking call open.

## Validating many concepts efficiently

`authoring-cli review-concepts` lists every concept with pending *stated* changes in its top-level
`concepts` array — the authoritative "what did I actually edit" list for a session. Its separate
`conceptsClassified` array is concepts touched only by a *previous* classification run's inferred-
relationship side effects, not by your own edits — don't re-validate those as if you'd changed them.

Run `validate-concept --id <id>` on every ID from `concepts`, not the whole-branch `authoring-cli
validate-task` — the whole-branch check is slower and mixes in unrelated concepts elsewhere on the
same task branch, making it harder to tell which warnings are actually yours. The names are
deliberately distinct: `validate-task` validates the entire task branch (an async job, like
`classify`); `validate-concept` is a synchronous, read-only check of one concept's current saved
state.

## Large multi-session batches

Generating many structurally-parallel concepts from a large source list (tens to thousands of
rows) is its own kind of task: it needs a persistent, resumable tracker so no session reprocesses
or loses track of prior work, and a deliberate batch size per session so everything created gets
fully validated and classified before moving on rather than accumulating unverified changes. See
`references/batch-authoring.md` for that methodology.
