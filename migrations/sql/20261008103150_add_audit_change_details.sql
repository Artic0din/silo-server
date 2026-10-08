-- +goose Up
-- Keep the existing timestamp/account indexes. Building additional indexes in
-- this transaction would retain the column-addition lock across history scans.
ALTER TABLE activity_log ADD COLUMN action text NOT NULL DEFAULT '',
 ADD COLUMN target_type text NOT NULL DEFAULT '',
 ADD COLUMN target_id text NOT NULL DEFAULT '',
 ADD COLUMN changes jsonb NOT NULL DEFAULT '[]';

-- +goose Down
ALTER TABLE activity_log DROP COLUMN changes, DROP COLUMN target_id, DROP COLUMN target_type, DROP COLUMN action;
