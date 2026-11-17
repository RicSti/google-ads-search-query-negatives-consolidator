# Search Query Negatives Consolidator – Google Ads Script

Shrinks shared negative keyword lists **without blocking less traffic**: groups of `[exact match]` negatives that share the same words are replaced by **one** `"phrase match"` negative, and negatives that are already blocked by another negative of the same list are removed.

```
[cheap flights rome]
[cheap flights paris]          →   "cheap flights"
[cheap flights to london]
[last minute cheap flights]
```

Built as companion of the [Search Query Excluder](https://github.com/RicSti/google-ads-search-query-excluder), which fills lists with exact negatives – until Google's limit of 5,000 negatives per list is reached. Runs inside a single Google Ads account. No API keys, no external services.

## Features

- **Step 1 – remove redundant negatives** (no traffic impact)
  - duplicates
  - exact / phrase negatives already blocked by a phrase negative (`[weather today]` ← `"weather"`)
  - exact / phrase / broad negatives already blocked by a broad negative (`[jobs in hamburg]` ← `hamburg jobs`)
- **Step 2 – consolidate** exact negatives into phrase negatives of 2–5 words (greedy set cover: the phrase replacing the most negatives first). Existing phrase negatives covered by a new phrase are removed as well.
- **Step 3 – single terms and word families**: an off-topic word that occurs in several negatives becomes **one one-word phrase negative**, and related word forms are excluded with it (details below).
- **Conflict check**: negatives that match your positive pattern or block one of your own keywords / relevant search terms are reported (and optionally removed) – they cost relevant traffic.
- **Safety nets** – a new phrase is rejected if it
  - matches your *positive pattern* (the regex of the Search Query Excluder)
  - is contained in one of your own keywords
  - is contained in a relevant (pattern match) or converting search term of the last 90 days
  - consists of filler words only or starts / ends with one (`"flights to"`)
- **Dry run** globally or per rule (`mode = test`)
- **HTML summary e-mail** (English or German) with new phrases, removed negatives and rejected candidates
- **CSV backup** of every removed negative attached to the e-mail
- **Log tab** in the Google Sheet
- **Shares the `rules` tab with the Search Query Excluder** – one sheet for both scripts
- Changes are made phrase by phrase: an exact negative is only removed after the phrase replacing it was accepted by Google Ads

## Single terms and word families

Example from a Taekwon-Do school – 107 exact negatives created by the Search Query Excluder:

```
[karate landshut], [karate], [kinder karate münchen], … (17)   →  "karate"
[kickboxen in der nähe], [kickboxen kinder], …          (6)   →  "kickboxen"
[kung fu landshut], [kung fu lernen in der nähe], …     (3)   →  "kung fu"
[boxen landshut], [landshut boxen], …                   (4)   →  "boxen"
   word family box*:  [boxclub in meiner nähe]                →  "boxclub"
                      [boxing für kinder in der nähe]         →  "boxing"
                      [kinderboxen in der nähe]               →  "kinderboxen"
```

Result in the dry run: 107 → 61 negatives, and every future search containing *karate*, *boxclub*, … is blocked without a new negative.

How it works:

1. **Single terms** – every word occurring in at least `SINGLE_TERM_MIN_COVERAGE` (3) exact negatives is a candidate. If all its negatives share more words, the phrase is extended (`kung` → `"kung fu"`, `courage` → `"la courage"`).
2. **Word families** – words with the same stem belong together: `boxen`, `boxing`, `boxclub` start with `box`, `kickboxen` and `kinderboxen` contain `boxen`. A family needs an *anchor* that qualifies as single term on its own (`boxen`, 4×). Once the anchor is excluded, every other member becomes a phrase negative too – even if it occurs only once. Google Ads has no substring negatives, so each word form needs its own negative.
3. **Greedy selection** – the term covering the most negatives wins first. Words that only occur together with an already excluded term ("münchen" in `[karate für kinder münchen]`) drop below the threshold and are left alone.

One-word negatives block the most traffic, so they have extra safety nets:

- `GENERIC_WORDS` (built-in, German + English): words that also appear in relevant searches – *nähe, kinder, preise, kurs, training, probetraining, online, …* – never become one-word negatives.
- `PROTECTED_WORDS` / rule column `protectedWords`: your own additions, typically **cities and districts of the target area** and your services.
- Words that are part of the positive pattern (`sport` in `kam[pf]{1,3}[\s-]*sport`) are rejected.
- The usual checks against own keywords and relevant / converting search terms (`landshut` is rejected because of the keyword `taekwondo landshut`).

Check the table *New phrase negatives* in the dry run mail – column *Basis* shows whether a phrase is a shared phrase, a single term or a word family member. Switch off with `SINGLE_TERMS = false` or `WORD_FAMILIES = false`.

## Quick start

1. In Google Ads open **Tools → Bulk actions → Scripts** and create a new script.
2. Paste the content of [`negatives-consolidator.js`](negatives-consolidator.js).
3. Edit the `SETTINGS` block at the top:
   - `RULES` (or `SPREADSHEET_URL`, see below)
   - `NOTIFY_EMAILS`
4. Click **Authorize**, then **Preview**. `DRY_RUN = true` is the default, so nothing is changed.
5. Check the log and the e-mail – especially the new phrase negatives. If the result is plausible, set `DRY_RUN = false` and schedule the script (weekly is a good start; when combined with the Search Query Excluder run the consolidator after it).

## Rules

One rule per negative keyword list.

| Field | Meaning | Example |
|---|---|---|
| `listName` | Shared negative keyword list to consolidate | `SQE - AI Max negatives` |
| `positivePattern` | Regular expression (case-insensitive) describing **relevant** searches. A new phrase matching it is never added. Optional, but strongly recommended. | `(shoe\|sneaker)s?` |
| `campaignFilter` | Campaigns whose keywords and search terms are used for the safety check, `%` = wildcard. Empty = all campaigns the list is attached to. | `%AI Max%` |
| `minCoverage` | Optional: min. number of exact negatives a new multi-word phrase must replace (default `MIN_COVERAGE` = 8) | `5` |
| `singleMinCoverage` | Optional: min. number of exact negatives for a single term (default `SINGLE_TERM_MIN_COVERAGE` = 3) | `4` |
| `protectedWords` | Optional: words that must never become one-word negatives (comma or space separated) | `landshut, ergolding, kinder` |
| `mode` | `live` or `test` | `live` |
| `active` | `false` = ignore rule | `true` |

If several rules use the same list (e.g. one per campaign group), the list is consolidated once and protected by all their patterns and campaign filters. If one of them is in test mode, the whole list is.

### Option A: rules in the script

```js
const SPREADSHEET_URL = '';
const RULES = [
  { listName: 'SQE - AI Max', positivePattern: 'shoe|sneaker', campaignFilter: '%AI Max%', mode: 'live', active: true },
  { listName: 'SQE - Brand',  positivePattern: 'mybrand|my brand', minCoverage: 5, mode: 'test' }
];
```

### Option B: rules in a Google Sheet

1. Put the URL of a Google Sheet into `SPREADSHEET_URL` – this can be the **same sheet as for the Search Query Excluder**.
2. The script reads the tab `rules` (created on the first run if missing). Columns are found by their header names, the order does not matter:
   `active | campaignFilter | listName | positivePattern | … | consolidate | consolidatorMode | minCoverage | singleMinCoverage | protectedWords`
3. Optional consolidator-only columns:
   - `consolidate` – `false` = this row is ignored by the consolidator (but still used by the Excluder)
   - `consolidatorMode` – `live` / `test` for the consolidator only (otherwise `mode` is used)
   - `minCoverage`, `singleMinCoverage`, `protectedWords` – see above
4. Every run appends to the tab `consolidator_log`.

## Settings reference

| Setting | Default | Description |
|---|---|---|
| `DRY_RUN` | `true` | Report only, change nothing |
| `SPREADSHEET_URL` | `''` | Use rules from a Google Sheet |
| `NOTIFY_EMAILS` | – | Recipients of the summary e-mail |
| `SEND_EMAIL_IF_NOTHING_CHANGED` | `false` | Also send a mail when nothing happened |
| `EMAIL_LANGUAGE` | `'en'` | `'en'` or `'de'` |
| `EMAIL_MAX_ROWS_PER_LIST` | `50` | Rows per table and list in the mail |
| `ATTACH_BACKUP_CSV` | `true` | Attach a CSV of all removed / added negatives |
| `MIN_COVERAGE` | `8` | Min. exact negatives one new phrase must replace |
| `MIN_WORDS` / `MAX_WORDS` | `2` / `5` | Length of new phrase negatives in words |
| `REMOVE_REDUNDANT_NEGATIVES` | `true` | Step 1 (duplicates / already covered negatives) |
| `SINGLE_TERMS` | `true` | One-word phrase negatives for frequent off-topic terms |
| `SINGLE_TERM_MIN_COVERAGE` | `3` | Min. exact negatives containing the term |
| `WORD_FAMILIES` | `true` | Exclude related word forms together (boxen, kickboxen, boxclub) |
| `MIN_ROOT_LENGTH` | `3` | Min. length of a word stem |
| `GENERIC_WORDS` | de + en | Never one-word negatives |
| `PROTECTED_WORDS` | `''` | Own additions to `GENERIC_WORDS` (cities, services, …) |
| `REMOVE_CONFLICTING_NEGATIVES` | `false` | Also remove negatives that contradict the rule (always reported) |
| `STOPWORDS` | en + de | Filler words, see above |
| `SKIP_STOPWORD_EDGES` | `true` | Phrases must not start or end with a filler word |
| `CHECK_SEARCH_TERMS` | `true` | Check new phrases against relevant / converting search terms |
| `CHECK_DATE_RANGE` | `90` | Date range for that check (days or `LAST_30_DAYS` etc.) |
| `PROTECT_CONVERTING_TERMS` | `true` | Search terms with conversions count as relevant |
| `PROTECT_OWN_KEYWORDS` | `true` | Reject phrases contained in own keywords |
| `MATCH_TRANSLITERATED` | `true` | ä/ö/ü/ß-tolerant pattern matching |
| `MAX_NEW_PHRASES_PER_LIST` | `100` | Limit per list and run |
| `MAX_REMOVALS_PER_LIST` | `2000` | Limit per list and run, the rest follows next run |

## Good to know

- **A phrase negative blocks more than the exact negatives it replaces** – every future search containing the phrase. That is the point (fewer negatives, same or better coverage), but review the new phrases in the dry run. Raise `MIN_COVERAGE` or `MIN_WORDS` if they are too broad.
- Negative keywords do not match close variants: `"cheap flights"` does not block `cheap flight`. The script therefore only uses word sequences that literally appear in your exact negatives.
- The safety check only knows search terms Google reports and your keywords – a relevant search that never occurred cannot be protected. A good `positivePattern` is the best protection.
- Undo: the backup CSV lists every removed negative. Re-add them via Google Ads Editor (or the list's UI) and remove the phrase negative.
- Without `campaignFilter` the safety check uses the campaigns the list is attached to. Google Ads Scripts only return Search / Display campaigns there – for other campaign types set a `campaignFilter`.
- The script runs in a single account. For manager accounts (MCC) run it in each client account.

## Development

The script has no dependencies. Tests run with Node.js and mocked Google Ads objects:

```bash
node test/run-tests.js
```

The test writes a preview of the e-mail to `test/output/mail.html` and the backup CSV to `test/output/backup.csv`.

## License

[MIT](LICENSE) © 2026 [adtraffic](https://www.adtraffic.de)

Use at your own risk. Always start with `DRY_RUN = true`.
