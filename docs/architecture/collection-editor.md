# Collection editor

The web edits every collection on one page, for server (library) and personal collections alike:
`web/src/pages/CollectionEditorPage.tsx`. This page covers how that page saves, because the
collection's titles and its other fields reach the server by different routes with different
tokens. Manual and Smart collections use the page today; Synced lists still open their earlier
editors inside it.

## Routes

`/admin/collections/new`, `/admin/collections/:id/edit`, `/collections/new` and
`/collections/:id/edit` each sit under one pathless layout route per family, so the page stays
mounted from `/new` to `/:id/edit`. After Create the page replaces the URL with the new
collection's edit URL and keeps the same draft, with focus in the title search. The page reports
itself clean until the URL has moved, so the unsaved-changes guard never asks during that step.

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

## Title search

The title search uses the viewer-scoped catalog query (`POST /api/v2/catalog/query`), so it offers
only titles the viewer can see: titles from libraries the profile can't open and titles above its
rating ceiling are not returned. A server collection with one library searches that library; with
several, the web searches each (at most four requests at once) and merges the results by rank. A
personal collection searches every library the profile can see. The search is a convenience,
not the access check: the personal item route refuses a title the acting profile can't see, and a
server collection's members are filtered per viewer when they are read.
