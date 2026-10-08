CREATE VIRTUAL TABLE dictionary_note_fts USING fts5(
	note_id UNINDEXED,
	excerpt,
	comment,
	terms,
	tokenize = 'simple 0'
);
