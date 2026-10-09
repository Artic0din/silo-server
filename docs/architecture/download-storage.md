# Prepared download storage

Remux and transcode downloads are served from prepared files (`download_artifacts`)
kept on the API server's artifact directory or on a transcode node's. This note covers
how long those files stay, how the server measures and limits the space they take, and
how an administrator removes them or revokes device copies. The implementation is
`internal/downloads` (`storage_*.go`) and `internal/downloadstorage`; the client
contract is in [downloads-api.md](../downloads-api.md), the admin operations in
[admin-api.md](../admin-api.md#offline-download-storage).

## Retention rule

A prepared file is **in use** while an in-flight managed download links it: status
`preparing`, `ready`, or `downloading`. A `completed` row does not hold its file; the
device already has the bytes. A ready file nothing is in flight on is **cached**: it
stays for `download.artifact_cache_hours` (default 72) after its `last_used_at`, so
another device or a re-download can reuse it, then it **expires**.

`expired` is an artifact status, not a deleted row. Expiry removes the bytes (a node
file through the remote orphan queue, written in the same transaction that clears the
row's locator) and keeps the row, because finished downloads still reference its
recipe and manifest. A request that needs an expired file requeues it like a failed
one; `POST /downloads/{id}/prepare` does this for a finished row whose device asks for
the file again. An expired row nothing references is deleted by the stale sweep.

A missing file found by recovery, or a node requeue, expires the row instead of
deleting it, and only in-flight rows are reset to `preparing`. An expired row is not a
preparation: the admin preparation list, queue positions, and cancel skip it. A row
any live download refers to (in flight or finished) is never deleted by the failed
sweep or by a revoke's cancel of abandoned preparations, because finished downloads
read its recipe.

## Locations, budgets, and the disk ceiling

A location is the API server (`server`, every replica shares one directory) or one
transcode node (`node:<id>`). Each has a budget: the node's
`download_artifact_max_bytes_override` when set (0 means no budget), otherwise
`download.artifact_max_bytes`. A node can also set `download_artifact_dir_override`;
the node applies it at its next restart.

Maintenance runs every five minutes on one replica at a time, under the session
advisory lock `pg_try_advisory_lock(0x5110d1, 1)`. Each pass, per location:

1. Expire cached files past the cache period.
2. Once cache expiry has run everywhere, if ready bytes exceed the budget, or the
   filesystem is above `download.artifact_disk_ceiling_percent` (default 85, range
   50–95), expire cached files least recently used first until enough is freed.
   In-use files are never expired by this pass.
3. A node that is still over with nothing left to free is storage-full and receives
   no new preparations. Every replica recomputes this from the database on each
   tick, so placement agrees whichever replica ran the pass.

A pass is bounded to 30 seconds and 200 candidates per query, so a backlog drains over
several passes. Locations whose measurements report the same filesystem type and exact
size are treated as one disk, such as nodes sharing a volume: what the pass frees at
any of them counts toward the ceiling of all of them, so an overage is freed once. The
ceiling acts only on a measurement newer than 15 minutes and newer than the last
removal of any kind on that disk recorded in history before the pass began, so a
measurement that still counts removed bytes is never acted on, by this replica or
another. Grouping two identical disks by mistake only delays one of them by a pass.

A server file counts as freed only once it is deleted. One that cannot be deleted has
no ready row left, so the next reconciliation reports it as untracked. An
administrator's delete of a file downloads still need moves the row back to the queue
first and removes the file second, so a failure never leaves a ready row without its
file.

## Measurement

Usage is read from disk, not from the database. `downloadstorage.Prober` measures a
directory asynchronously (one walk in flight, at most every five minutes, 10-second
timeout) and reports file counts and bytes by kind (complete, partial, other), the
filesystem's size and fill, its type, whether it is ephemeral (tmpfs, overlay, ramfs),
and whether it shares a device with the transcode scratch directory. A failed or
overdue walk is reported as stale rather than as zero.

The API server stores its measurement in `download_storage_samples` so every replica
serves the same numbers; a replica's row is pruned after seven days without an update.
Measurement errors carry the operation and errno, never the path. Nodes report theirs in the `artifacts` block of
`/api/v1/health`, which the API already polls every 30 seconds and keeps in
`stream_nodes.last_stats`; that block carries no paths.

## Reconciliation

Hourly, and when an administrator asks for clean-up, the server lists each directory
(its own, and each node's through `GET /downloads/artifacts`) and compares the names
with the rows that should own them. A file named like the location's prepared files
(`<media file>_<format>_<hash>_<id>.mp4` on the server, `<id>-<uuid>.mp4` and its
`.part` and receipt files on a node) that no row accounts for and that nothing has
written to for an hour is **untracked**. Any other file in the directory is never
untracked, so a directory shared with other data, or with another location, cannot
lose files Silo did not write; a node's check covers every node's rows, since nodes
may share a volume. Untracked files are counted, never deleted automatically; an
administrator deletes them, and the server lists the directory again before doing
so.

## History

Every removal writes `download_storage_events`: one row per file, grouped by a batch id
per pass or action, with the reason (`cache_expired`, `budget`, `disk_ceiling`,
`admin_delete`, `untracked`, `missing`, `revoked`, `device_removed`), location, title,
bytes, and the acting administrator. History is pruned after 90 days. The admin-only
realtime event `download_storage.changed` on the `download_preparations` channel tells
storage views to re-read after a pass that freed bytes or an action.

## Revocation

An administrator can revoke managed downloads (listed rows, or every row on one
device). The row becomes `revoked` with `revoked_at`, `revoked_by`, and an optional
reason; the file route refuses it, and its prepared file becomes cached if nothing else
is in flight on it. A preparation only revoked rows were waiting on is canceled; the check that no live
download refers to it runs in the statement that deletes it. History counts the size
of the copies the device had finished downloading.
A revoked episode is excluded from the device's series monitor, and a whole-device
revoke can pause the device's monitors.

Revocation is a request, not enforcement: an app that supports it deletes its local
copy at its next registry sync and then deletes the row, which records a
`device_removed` event. A revoked row the device never confirms is pruned after 90
days. Registry syncs update the device's last-seen time, which the admin views use to
flag devices not seen in 14 days.

## Metrics

- `silo_download_storage_freed_bytes_total{location,reason}`
- `silo_download_storage_bytes{location,state}` (`in_use`, `cached`, `untracked`)
- `silo_download_storage_sample_timestamp_seconds{location}`
