# Large multi-session batch authoring

Generalized from a real ~1,400-row batch (turning "finger"-specific SNOMED CT concepts into
parallel "digit of hand" concepts via the substitution pattern in `SKILL.md`'s "Generating a
concept structurally parallel to an existing one"). The domain specifics don't matter here — what
matters is the shape of the methodology, which applies to any authoring-cli task where you're
mechanically processing a large source list across many sessions: bulk site substitutions,
laterality generalizations, bulk description edits, anything where the same recipe applies to
hundreds or thousands of rows one at a time.

## Why this needs its own methodology

A batch this size can't be done in one sitting, can't be re-derived from memory each session, and
shouldn't be attempted all-at-once without verification — three problems a plain TODO list doesn't
solve:

- **Resumability.** Without a persistent record of what's been done, a new session (or the same
  session much later) either re-does work or loses track of where it left off.
- **Triage needs to survive across sessions.** Some rows are excluded, some are blocked on a
  prerequisite, some need a human judgment call — that reasoning shouldn't be re-derived every time
  the same row comes up again.
- **Unverified volume is risky.** Creating 200 concepts and validating/classifying none of them
  yet means any systemic mistake (a wrong parent, a bad substitution) is now replicated 200 times
  before anyone notices.

## The tracker file

Keep one tracker file (TSV or CSV both work fine) alongside the source list, with at minimum:

```
id    label    status    new_concept_id    notes
```

Seed it from the source list with every row `UNPROCESSED` before doing anything else, if it doesn't
already exist. A reasonable status vocabulary — adapt the `SKIPPED_*` reasons to the actual task:

- `UNPROCESSED` — not yet looked at (the default).
- `DONE` — fully processed: created, retrofitted if needed, validated, and classified.
- `SKIPPED_SCOPE` — excluded by a mechanical scope filter (not a candidate for this task at all).
- `SKIPPED_BLOCKED` — depends on something that doesn't exist yet (e.g. a prerequisite concept
  that itself needs to be minted first) — out of scope for a mechanical pass.
- `SKIPPED_ALREADY_COVERED` — the target already exists (check both active *and* inactive results
  when searching — a superseded/inactive version doesn't mean the meaning isn't already covered by
  an actively-used sibling).
- `SKIPPED_TRIAGE` — needs a human judgment call (see the compound-word/idiom/cardinality caveats
  in `SKILL.md`'s substitution-pattern section) — don't guess through these mechanically.

Update the tracker for every ID touched at the end of *every* session, not just when a batch
finishes — this is what lets the next session (or a different session) resume cleanly instead of
rediscovering the same dead ends.

## Scope-filter mechanically, first

Most source lists mix genuine candidates with rows that don't need processing at all (already
too-specific, already covered by an existing generalization, non-substantive/idiomatic uses of the
term, wrong semantic category). Write a small filter script (grep/`jq`, not a general-purpose
scripting language — see below) that excludes the mechanical cases, and batch-mark everything it
drops with the appropriate `SKIPPED_*` status rather than hand-triaging each excluded row
individually. Save manual judgment for the smaller set of rows the mechanical filter can't decide.

## Batch size discipline

Process a comfortable batch per session — small enough to fully validate and classify before
moving on (10-20 concepts is a reasonable default), not "as many as possible in one pass." Creating
first and validating later means any systemic error compounds before you catch it; validating each
batch before starting the next one catches it after one batch's worth of damage, not the whole run's.

## Live verification over static mappings

If the batch's substitution logic depends on knowing "concept A is the correct generalization of
concept B," don't build a static lookup table and trust it for the whole run — terminology content
changes, and a stale table will confidently substitute in a superseded or wrong concept. Look it up
live via `search-concepts` with an exact match check each time (see `SKILL.md`'s substitution
pattern), even if that means repeating the same lookup across many rows that happen to share a
value. If repeated re-lookups genuinely become a bottleneck at scale, that's a reasonable time to
introduce a cache — but validate the cache against live search periodically rather than treating it
as permanently authoritative.

## Scripting against authoring-cli's JSON output

Shell scripts that automate scope-filtering or candidate discovery should parse `authoring-cli`'s
JSON output with `jq`, not a general-purpose scripting language — it keeps the script a single
dependency-free file and makes the intent legible at a glance:

```bash
json=$(authoring-cli get-concept --id "$id" --project "$PROJ" --task "$TASK" 2>/dev/null)
defstatus=$(echo "$json" | jq -r '.definitionStatus')
sites=$(echo "$json" | jq -r '
  [.classAxioms[]?.relationships[]? | select(.typeId=="363698007")]
  | .[] | [.target.fsn.term, .destinationId, .groupId] | @tsv
')
```

Such a script should only ever *find candidates* — it shouldn't decide fitness for creation on its
own. Keep the compound-word/idiom/cardinality judgment calls (see `SKILL.md`) as an explicit manual
step after the script narrows the field, not folded into the script's filtering logic.

## Closing out a session

Report, and record in the tracker: how many created, how many skipped and why (grouped by
`SKIPPED_*` reason), any redundant-Is-a warnings found and resolved, and anything intentionally
left in place for human cleanup (e.g. a genuinely versioned axiom that can't be edited via the CLI
— see `SKILL.md`'s redundant-Is-a section). This is what makes "continue the batch" a safe thing to
ask for in a future session without re-deriving any of this context.
