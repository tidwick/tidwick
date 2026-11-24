-- The SHA-256 of the canonical import mapping each batch was applied under, so the same file under another
-- mapping is refused instead of writing a second set of entries. Batches already stored read '' and count as
-- applied under a different mapping.
ALTER TABLE import_batch ADD COLUMN mapping_hash TEXT NOT NULL DEFAULT '';
