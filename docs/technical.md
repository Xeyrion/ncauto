# NCAuto — Technical Notes

[中文版](technical.zh-CN.md)

This document records the reverse engineering findings behind NCAuto:
the official export formats, the application's private API procedures,
the message schemas, and the verified behaviors and constraints.
All statements below are reproducible through traffic capture.

---

## 1. Background

- Per the official documentation (June 2026), Codex supports export to ZIP
  but provides no import function; entries must be recreated manually or via
  Extract.
- Export entry point: the gear icon in the Codex sidebar, producing a ZIP
  archive.
- Objective: write the contents of such an export (Codex / Snippets / Chats)
  back into any book the operator has write access to, in bulk.

## 2. Export formats (input side)

### 2.1 Codex export (`*- codex.zip`)

```
<characters|locations|lore|objects|subplots|other>/<name>-<27-char id>/
    metadata.json   # {id, attributes:{type,name,color,aliases,tags,
                    #   alwaysIncludeInContext,doNotTrack,noAutoInclude},
                    #  relationships:{nestedEntries:[id...]}, links:{...}}
    entry.md        # YAML frontmatter + Markdown body (description)
    notes.md        # research notes as plain text (present only when non-empty)
codex.html          # summary preview; safe to ignore
```

- Type mapping (plural directory name to singular record value):
  `characters→character`, `locations→location`, `lore→lore`,
  `objects→object`, `subplots→subplot`, `other→other`.
- One field name differs between export and write API:
  `alwaysIncludeInContext` (export) vs. `alwaysInclude` (API).

### 2.2 Full project export (`*- full.zip`, all three export-wizard options selected)

In addition to §2.1, the archive root contains:

```
novel.md                 # manuscript body (not used by the importer)
snippets/<YYYY-MM-DD> [<title> - ]<first-8-chars-of-id>.md
codex.html
```

`snippets/*.md` format: frontmatter (`title` / `favourite`) followed by a
plain-text body with paragraphs separated by blank lines.
Only the first 8 characters of the ID are retained; the full primary key is
unavailable, so new IDs must be generated on import.

### 2.3 Chat export (`*- chats.zip`, or full export with Chats selected)

```
<YYYY-MM-DD> [<title> - ]<first-8-chars-of-id>.md   # archive root or chats/ subdirectory
```

Frontmatter is identical to Snippets. The body is segmented by role headings:
`## User` / `## AI` (`Assistant` is treated as equivalent) / `## System`.

## 3. Traffic capture methodology

1. Launch Chromium with HAR recording; sign in manually and open the target book.
2. Create one Codex entry manually (using a distinctive name such as
   `TEST_PROBE_xxx` for reliable identification in the capture), then allow ~3 seconds
   for autosave.
3. Search the HAR for `TEST_PROBE` to identify the genuine write request.
   Note: filtering by URL keywords such as `codex|entries` only surfaces
   Sentry telemetry; searching by a distinctive content string is required.
4. Result: record creation is issued to
   `app.novelcrafter.com/api/trpc/data.commit`, and body updates to
   `data.updateOne`.

## 4. Authentication

- Session state: the `__session` cookie (**not HttpOnly; readable from page
  context**) stores a JWT; requests carry an
  `Authorization: Bearer <JWT>` header.
- userId is the `sub` claim of the JWT payload (base64url-decoded).
  The suffixed `__session_*` cookies must not be used; they yield HTTP 401.
- Standard headers: `novelcrafter-client-version: client@f81152`,
  `novelcrafter-client-time: <epoch-ms>`,
  `novelcrafter-client-token-time: 0`, `content-type: application/json`.
- The userscript approach: passively intercept the `Authorization` and
  `novelcrafter-client-version` headers from the application's own tRPC
  requests. Cookies are attached automatically by the browser, and token
  rotation is handled by always using the most recently observed values.

## 5. tRPC envelope format

- Queries: `GET /api/trpc/<procedure>?batch=1&input=<URL-encoded {"0":{"json":<argument>}}>`.
- Mutations: `POST /api/trpc/<procedure>?batch=1` with body
  `{"0":{"json":<argument>},"meta":{...}}`.
- Success: `[{"result":{"data":{"json":...}}}]`; failure:
  `[{"error":{"json":{"message","code","data":{"code","httpStatus","path"}}}}}]`.
- A malformed argument yields `BAD_REQUEST` (400); a nonexistent procedure
  yields `NOT_FOUND` (404), which permits probing for procedure existence.
- `Date`-typed values require corresponding `meta.values` declarations
  (e.g., `"transaction.upsert.0.meta.createdAt": ["Date"]`).
  When a single commit batches multiple upserts, **each index must be declared
  individually**, otherwise the server returns 400.

## 6. Endpoint inventory (verified)

| Procedure | Method | Argument | Purpose | Status |
|---|---|---|---|---|
| `data.getAll` | GET | novelId **as a bare string** (an object wrapper yields 400) | Read all records of a book: novels/novelDetails/acts/chapters/scenes/codexEntries/snippets/chatThreads/chatMessages | Available |
| `data.commit` | POST | See §7 | Upsert arbitrary records | Available |
| `data.updateOne` | POST | See §7 | Update selected fields/relationships of a single record | Available |
| `snippets.getAll` | GET | novelId string | Read snippets | Available |
| `novels.getPermissions` | GET | novelId string | Query the current account's role/canWrite for a book (pre-write check) | Available |
| `snippets.create/upsert/update/...` | — | — | All return 404: **no dedicated snippet write procedure exists**; all writes go through `data.commit` | Unavailable |

## 7. Record payload reference

### 7.1 `codexEntries`

```json
{
  "id": "<27-char id>", "type": "codexEntries",
  "meta": {"createdAt": "<ISO>", "updatedAt": "<ISO>", "state": "active"},
  "attributes": {
    "type": "character|location|object|lore|subplot|other",
    "name": "…", "description": "<p>…</p>", "notes": "<p>…</p> or null",
    "tags": [], "aliases": [],
    "alwaysInclude": false, "doNotTrack": false, "noAutoInclude": false,
    "hideFromAi": false, "promptInclusions": null,
    "matchExclusions": [], "matchCaseSensitive": false, "color": null
  },
  "fields": {},
  "relationships": {
    "nestedEntries": ["<related entry id>"],
    "belongsTo": {"type": "novels", "id": "<novelId>"},
    "connections": []
  },
  "links": {"thumbnail": null, "externalReferences": []}
}
```

- `description` (Details) and `notes` (Research) are stored as **HTML**:
  paragraphs in `<p>`, intra-paragraph line breaks as `<br>`.
  Conversion from the Markdown export: split into paragraphs on blank lines,
  wrap each in `<p>`, convert intra-paragraph `\n` to `<br>`, and escape
  `&<>"'`.
- `context.event.name` uses `codex_entry_created` (not validated server-side;
  custom values are accepted).
- Writes follow the same two-phase sequence as manual creation in the UI:
  (1) commit an empty entry, then (2) write the details via updateOne.
  The updateOne `context` may be `null`;
  `relationships.nestedEntries` follows **replace (not append) semantics**.

### 7.2 `snippets`

```json
{
  "id": "<new id>", "type": "snippets",
  "attributes": {"title": "…", "favourite": false,
    "content": {"type": "doc", "content": [...]}},
  "relationships": {"belongsTo": {"type": "novels", "id": "<novelId>"}}, "links": {}
}
```

- The body is **ProseMirror/Tiptap JSON** (not HTML): blank-line segmentation;
  a single `#`-prefixed line becomes a heading; blocks consisting entirely of
  `-/*/+`-prefixed lines become a bulletList; blocks of `1.`-prefixed lines
  become an orderedList; intra-paragraph line breaks become hardBreak nodes.
- Event name `snippet_created`; one record per commit is sufficient.

### 7.3 `chatMessages` + `chatThreads`

```json
// message
{"type": "chatMessages",
 "attributes": {"type": "user|ai|system", "text": "plain text", "model": null},
 "relationships": {}}
// thread
{"type": "chatThreads",
 "attributes": {"title": "", "favourite": false,
   "includeOutlineInContext": false, "includeAllTextInContext": false,
   "inputs": {}, "memoryCutoff": 14, "thinking": null},
 "relationships": {"messages": ["<chronologically ordered message ids>"], "prompt": null, "model": null, "sceneContext": null}}
```

- Ordering: commit all messages first in a single commit (multiple upserts
  with per-index `meta` declarations), then create the thread referencing
  `messages`.
- Messages and threads carry no `belongsTo`; book ownership is determined by
  `context.scope.novelId` of the commit.

### 7.4 ID scheme

- IDs are 27-character base62 KSUIDs (time-sortable globally unique
  identifiers) with a space of 62^27 ≈ 2^161. Random collision probability is
  approximately 4×10^-49 — negligible for engineering purposes.
- `data.commit` performs upsert keyed on ID: unknown ID → insert;
  known ID → overwrite in place (re-importing with reused IDs is therefore
  inherently idempotent).
- **Reusing existing IDs across accounts yields 403**: IDs are global primary
  keys with ownership, so upserting an ID owned by another account is treated
  as an attempt to modify another party's record.
  Verified: same-account cross-book reuse succeeds; cross-account reuse fails
  (`FORBIDDEN -32003`); freshly generated random IDs succeed.
- Conclusion: reuse original IDs when importing an export from the same
  account (incremental sync without duplicates); generate new IDs when
  importing another account's export, relinking relationships via
  old-ID → name → new-ID mapping so that whole-project migration preserves
  the relationship graph.

### 7.5 Permission model

- HTTP 403 `You do not have permission to edit model "novels:<id>"` is the
  server-side final verdict: reads (`getAll`) succeed while writes are
  rejected when the current account lacks write access to the book
  (read-only share, wrong account, or cross-account ID reuse).
- Always query `novels.getPermissions` for `role`/`canWrite` before bulk
  writes and abort early on insufficient permission.

## 8. Import pipeline (NCAuto implementation)

```
Parse zip/folder/json → three selectable lists (Codex/Snippets/Chats)
  → permission pre-check → index existing records (name→id: dedup + relationship relinking)
  → pass 1: data.commit creates entries/snippets/messages/threads
  → pass 2: data.updateOne writes Codex details (body + notes + relationships)
  → summary log → operator refreshes the page (frontend cache is stale; data.getAll is authoritative)
```

- Duplicate skipping: Codex by name, Snippets/Chats by title (empty titles
  are exempt from matching).
- Relationship relinking: referenced IDs present in the current batch link
  directly; references to skipped existing entries relink by name; references
  resolving to neither are dropped and counted.
- Throttling: 200 ms per write by default plus random jitter; increase the
  interval on HTTP 429 or mass failures.

## 9. Observed behaviors and constraints

1. Filtering HAR captures by URL keywords is lossy: Sentry telemetry also
   matches such keywords. Search by distinctive content strings instead.
2. `data.getAll` requires the novelId as a bare string; an object wrapper
   yields 400.
3. Multi-upsert commits require per-index `Date` declarations in
   `meta.values`.
4. `nestedEntries` updates replace the full set; they do not append.
5. The panel itself resides in the document body: name matching against
   `innerText` must hide the panel first, otherwise every entry
   self-matches.
6. JSZip file objects expose `.async('text')`; only native File objects
   expose `.text()`.
7. The Tampermonkey `@require` CDN may fail entirely in regions with
   restricted CDN access; lazy loading with multi-CDN fallback is used
   instead.
8. Reads may be briefly inconsistent after writes; allow a short delay before
   verification. The sidebar is not updated in real time; refresh the page.
9. Redact JWT, userId, novelId, and private book titles before publishing
   articles or screenshots.

## 10. Risk statement

The interfaces described here are private and carry no stability guarantees;
upstream site updates may invalidate them at any time (typical symptom: mass
HTTP 4xx responses). This tool operates exclusively on books the signed-in
operator has write access to and does not bypass any server-side permission
checks. Retain this statement when redistributing.

## 11. Acknowledgments

Snippet/Chat message formats, full-export structure, and the idempotent-ID
design reference third-party `ncauto` research (`NOTES.md` plus the
`ncimport*.mjs` series). The zero-install Tampermonkey implementation is
original to this project.
