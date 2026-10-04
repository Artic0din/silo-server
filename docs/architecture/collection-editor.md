# Collection editor

The web edits every collection on one page, for server (library) and personal collections alike:
`web/src/pages/CollectionEditorPage.tsx`. This page covers how that page saves, because the
collection's titles and its other fields reach the server by different routes with different
tokens. Every type uses the page: Manual, Smart and Synced list, to create and to edit.

## Routes

`/admin/collections/new`, `/admin/collections/:id/edit`, `/collections/new` and
`/collections/:id/edit` each sit under one pathless layout route per family, so the page stays
mounted from `/new` to `/:id/edit`. After Create the page replaces the URL with the new
collection's edit URL and keeps the same draft, with focus in the title search. The page reports
itself clean until the URL has moved, so the unsaved-changes guard never asks during that step.

Creating starts from one **New collection** button on each collections list, which opens the type
picker (`web/src/components/collections/NewCollectionPicker.tsx`) over the list as
`?dialog=new`. Its Manual, Smart and Synced list cards are links to `/new?type=…`, carrying the
list's selected library on the server list. The Synced list card waits for the scope's
capabilities and is disabled when `import_sources` is empty. A `/new` URL with no `type` redirects
to the list with the picker open, so older links keep working.

A viewer who can't change the collection never sees a form: the page sends them to the
collection's own page with `?notice=read-only`, which shows who can change it. Personal ownership
fails closed, so the page waits for the acting profile before it decides.

## What saves when

- **Titles save as you change them.** Adding, removing and reordering a Manual collection's titles
  call the item routes at once (`PUT …/items/{item_id}`, `DELETE …/items/{item_id}`,
  `PUT …/items/order`). A removal can be undone for six seconds; Undo puts the title back at its
  old position.
- **Everything else waits for Save.** Name, description, libraries, a Smart collection's rules and
  Order, artwork and the switches in Where it shows are a draft (`CollectionDraft`, `web/src/lib/collections/scope.ts`). The save bar
  names the fields that are pending and says titles are already saved. Discard never touches
  titles.
- **Before the collection exists**, picked titles are staged in the draft. Create sends the POST,
  then one `PUT` per staged title in order. Titles that fail stay listed and marked, with Try
  again.
- **Artwork** saves after the collection: a file or link uploads, a staged removal sends `DELETE
  …/image`, and a new file in the same slot replaces the image without a DELETE. A slot whose
  upload fails after the collection saved stays staged and offers Retry.
- **Pin** (`featured`) is not part of the draft. It is set in Arrange. A collection created in the
  editor is created unpinned, and an editor PATCH leaves `featured` out, so a stale editor can't
  undo a Pin set elsewhere.

## Tokens and merging

Guarded writes carry `If-Match`. Every title write changes the collection's revision, and so its
ETag, without the editor's draft changing. To keep Save working:

1. After each title write the editor reads the collection again (`syncWithServer` in
   `useCollectionDraft`, `web/src/hooks/queries/collectionScope.ts`) and keeps the fresh ETag.
2. It merges the fresh copy into the draft with a three-way merge against the copy the draft
   started from (`mergeDraft`, `web/src/lib/collections/draft.ts`). Per field: changed only on the
   server, the draft takes the server's value; changed only in the draft, the draft keeps it;
   changed to the same value, no conflict; changed differently, the draft keeps its value and the
   field is a conflict. The fresh copy becomes the new base.
3. A Save that still answers `412` reads and merges the same way. With no conflicting field it
   retries once with the new ETag and no prompt. With a conflict it stops and shows the banner
   "This collection changed since you opened it." with Keep mine and Use theirs.

A reorder uses the item-order ETag from `GET …/items/order`, read again after every title write,
not the collection's ETag.

Because each save merges against a fresh read, two editors on different nodes, or an editor and a
sync, never overwrite each other's fields silently: the later save either carries the other
change forward or stops at the conflict.

## Smart rules and the live preview

A Smart collection's Contents is the Home rows rule sentence (`RuleBuilder`), with the libraries
inside it: a server collection needs at least one, and a personal one with none matches every
library the profile can see. Rules about the viewer (Watched and the like) are offered only on a
personal collection. A rule the builder can't show stays as a locked line and is saved unchanged
until someone removes it. The draft's libraries are the rules' `library_ids`; a library change
counts once, as Libraries.

The preview sends the whole draft `query_definition`, across every chosen library, to the scope's
preview route (`POST …/collections/preview`, 24 titles), 300 ms after the last edit. It shows the
unsaved rules, so the save bar says the preview already shows them. A rule set that matches nothing
still saves.

A Smart collection may carry a stored default sort in `sort_config` (`field` and `order`), which
wins over the rules' sort when viewers open it. The Order block names it with Clear. Changing the
sort or direction clears it too, so the new Order takes effect; clearing drops only `field` and
`order` and keeps any other `sort_config` setting. An untouched stored sort is sent back as it was.

## Creating a Synced list

`/new?type=synced` (with `&source=mdblist`, `tmdb_chart` or `tmdb_list` to pick the opening tab)
shows one source panel. Its tabs follow the scope's `import_sources`. The panel's state is the
draft's `synced` member (`web/src/lib/collections/synced.ts`): the list it will follow, the typed
links, max titles and the schedule.

- **Picks fill only untouched fields.** A ready-made pick (a template) or an MDBList search result
  fills Name, Description, max titles, schedule and the poster. The draft remembers what the last
  pick filled; a field that still holds that value (or is blank) takes the next pick's value, and
  a field changed by hand stays and is named under Name ("Kept your name"). A search result brings
  only its own name and description, never a template's.
- **Only creatable templates show.** A template appears when its source is one of the scope's
  `import_sources` and it needs no profile; Discover and Franchise templates come only with Starter
  packs. Templates that ask for a link are left out, because the panel has its own link fields.
- **Links.** A pasted MDBList link loses its `?query`, `#fragment` and trailing slash before it is
  sent; a `/json` ending is kept. The server normalizes and allowlists it again. A TMDB list link
  is sent as typed.
- **TMDB charts** offer only the choices `validateTMDB` accepts (`web/src/lib/collections/tmdbSources.ts`).
- **Libraries.** A list of only movies or only shows leaves out libraries of the other kind and
  unticks them.
- **Create** posts the scope's import route (`POST …/collections/import/{mdblist,tmdb,tmdb-list}`),
  which runs the first sync, then saves artwork as for other collections. A server list is
  imported with `featured: false`. A pick's poster is sent as `poster_url` unless the poster slot
  replaces or removes it. The personal import takes no Collections tab choice, so with the switch
  on the web reads the new list and sends a guarded `PATCH` with `include_in_server_collections`.
  The page then moves to the new list's edit URL.
- **Schedules.** A server list takes a cron schedule, labelled with the answering node's offset
  from `schedule_time_zone`, because cron runs in the node's local zone. A personal list takes a
  named schedule (Manual only, Daily, Weekly, Monthly); a template's cron maps to the nearest one,
  never more often than daily.

## Editing a Synced list

A saved Synced list keeps what it follows in the draft's `list` member (`ListDraft`,
`web/src/lib/collections/scope.ts`): the link, chart or TMDB collection ID, max titles and the
schedule. They save with the rest of the draft and merge three-way like other fields; what the
list follows counts once, as the list.

- **What can change depends on the source.** A server MDBList or TMDB list changes its link; a
  server TMDB chart changes its chart or moves to a TMDB list; a franchise list changes its TMDB
  collection ID. A profile changes its MDBList or TMDB list link; a chart it follows stays as it was
  made. Discover lists (from Starter packs) and legacy Trakt lists show their source read-only.
- **What a server save sends.** The PATCH carries every field and rebuilds the source whole
  (`source_url` and `source_config`), as the server stores it: a changed MDBList link loses its
  `?query`, `#fragment` and trailing slash, and a TMDB list link becomes its canonical
  `https://www.themoviedb.org/list/{id}`. A Discover list and a franchise list with no ID yet send
  no source unless max titles changed, and then send their stored config with the new limit; every
  Trakt list sends no source, so the server keeps the stored one. A new chart unticks libraries that
  can't hold its titles, as on create, because the server doesn't check library kinds on update. A Trakt list's
  libraries and max titles are locked, and a stopped Trakt schedule can't be turned on, because
  the server refuses those changes. A save never sends `featured`.
- **What a personal save sends.** Name, sharing, libraries, the Collections tab switch and Show
  only always go; description, order, the link (`source_url`), max titles (`max_items`, `0` for the
  whole list) and the schedule go only when they changed.
- **Schedules.** A personal list's schedule is shown by its cadence name (`sync_cadence`), never as
  cron. A cadence the names can't express reads "Custom schedule (current)" and is never sent back;
  picking another sends `sync_schedule`. The picker stays locked until the collections
  capabilities report `sync_schedule_editable`. A server list's cron is labelled with the answering
  node's offset, as when it was created.
- **Sync status.** The panel shows when the list last synced, when it syncs next, and how many of
  the list's titles a sync skipped because they are in none of its libraries. That count comes
  from a sync run (`items_unmatched`); the collection doesn't store it, so it is known only after
  Sync now on this page. A failed last sync shows its reason at the top, with Sync now on server
  lists.
- **Sync now** (header ⋯, server lists only) moves the collection's revision. When it finishes, the
  editor reads the collection again and merges (`syncWithServer`), so the next Save sends the
  current ETag. Personal editors have no Sync now; a profile syncs its lists from their cards on
  the Collections page.

## Title search

The title search uses the viewer-scoped catalog query (`POST /api/v2/catalog/query`), so it offers
only titles the viewer can see: titles from libraries the profile can't open and titles above its
rating ceiling are not returned. A server collection with one library searches that library; with
several, the web searches each (at most four requests at once) and merges the results by rank. A
personal collection searches every library the profile can see. The search is a convenience,
not the access check: the personal item route refuses a title the acting profile can't see, and a
server collection's members are filtered per viewer when they are read.
