-- A returned week says why: the approver's words, shown to the owner. Cleared when the week is submitted again or approved.
ALTER TABLE week_submission ADD COLUMN return_reason TEXT;
