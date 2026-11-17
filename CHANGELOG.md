# Changelog

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
