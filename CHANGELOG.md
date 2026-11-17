# Changelog

## 1.1.0 – 2026-11-17

- Single terms: an off-topic word occurring in several exact negatives becomes one one-word phrase negative (`"karate"`); extended to the longest shared phrase where possible (`"kung fu"`)
- Word families: related word forms are excluded together once the family's anchor is excluded (`"boxen"` → `"boxclub"`, `"boxing"`, `"kinderboxen"`)
- Safety nets for single terms: built-in generic word list (de/en), `PROTECTED_WORDS` / rule column `protectedWords`, words of the positive pattern
- Rule column `singleMinCoverage`
- Conflict check: negatives matching the positive pattern or blocking own keywords / relevant search terms are reported (optional removal with `REMOVE_CONFLICTING_NEGATIVES`)
- E-mail: column *Basis* (shared phrase / single term / word family), conflict table

## 1.0.0 – 2026-11-17

First public release as a single-account script (based on an internal MCC version).

- Rules in the script or in a Google Sheet (shares the tab `rules` with the Search Query Excluder, log in tab `consolidator_log`)
- Removes duplicates and negatives already covered by a phrase or broad negative of the same list
- Replaces groups of exact negatives by phrase negatives (greedy set cover, 2–5 words)
- Existing phrase negatives covered by a new phrase are removed as well
- Safety check of new phrases against positive pattern, own keywords and relevant / converting search terms
- Normalizes negative texts (match type syntax returned by `getText()` is stripped)
- Multiple rules for the same list are merged (all patterns and campaign filters protect the list)
- Phrase by phrase execution: replaced negatives are only removed after the phrase was added
- Limits per list and run, dry run globally and per rule
- HTML summary e-mail (en/de) with CSV backup of all removed negatives
