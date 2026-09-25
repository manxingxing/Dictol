//! Immutable headword index. Definitions and full-text postings never enter DIDX.
use crate::{Error, Result};
mod matching;
pub use matching::MatchKind;
use matching::{normalize, rank, wildcard_matches, wildcard_prefix};
use memmap2::Mmap;
use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use xxhash_rust::xxh64::xxh64;

const MAGIC: [u8; 8] = *b"DIDX\x01\0\0\0";
const HEADER_SIZE: usize = 96;
const FORMAT_VERSION: u32 = 3;
const NORMALIZATION_VERSION: u32 = 2;
const BLOCK_TERMS: usize = 32;
const MAX_LIMIT: usize = 10_000;
const MAX_FUZZY_DISTANCE: usize = 4;

/// One source record. The format adapter, not DIDX, interprets the locator.
#[derive(Debug, Clone)]
pub struct IndexEntry {
    /// Original spelling, preserved without truncation.
    pub key_text: String,
    /// Adapter-owned record address; never a permanent user-data identifier.
    pub locator: Vec<u8>,
}

/// Replayable source: allows a streaming build, with sorting only if needed.
pub trait IndexSource {
    /// Identity of the source content and adapter locator version.
    fn fingerprint(&self) -> Result<u64>;
    /// Return records in a stable order on every call.
    fn entries(&self) -> Result<Box<dyn Iterator<Item = Result<IndexEntry>> + '_>>;
}

/// One physical record and the reason it matched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexMatch {
    /// Original key, including case and punctuation.
    pub key_text: String,
    /// Normalized headword used for matching.
    pub normalized_key: String,
    /// Opaque bytes understood only by the source adapter.
    pub locator: Vec<u8>,
    /// Original physical key ordinal.
    pub key_ordinal: u64,
    /// Exact, case-insensitive, loose, prefix, fuzzy or wildcard.
    pub match_kind: MatchKind,
    /// Edit distance for fuzzy results only.
    pub distance: Option<u32>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
/// Completed, atomically published DIDX statistics.
pub struct BuildResult {
    /// Physical MDX entries.
    pub entry_count: u64,
    /// Unique normalized headwords.
    pub term_count: u64,
    /// File size in bytes.
    pub file_size: u64,
    /// On-disk format version, supplied by the writer.
    pub format_version: u32,
    /// Normalization algorithm version.
    pub normalization_version: u32,
}
#[derive(Debug, Clone, Copy)]
/// Metadata stored in the file header.
pub struct DidxMetadata {
    /// Physical MDX entries.
    pub entry_count: u64,
    /// Unique normalized headwords.
    pub term_count: u64,
    /// Source content identity supplied by the adapter.
    pub source_fingerprint: u64,
    /// On-disk format version.
    pub format_version: u32,
    /// Normalization algorithm version.
    pub normalization_version: u32,
}
#[derive(Debug)]
struct Block {
    first_key: String,
    offset: usize,
    length: usize,
    terms: usize,
    checksum: u64,
}
#[derive(Debug)]
/// Read-only mmap with a sparse directory (one entry per block, not per word).
pub struct DidxIndex {
    path: PathBuf,
    mmap: Mmap,
    metadata: DidxMetadata,
    blocks: Vec<Block>,
}
#[derive(Debug)]
struct BuildEntry {
    display: String,
    ordinal: u64,
    locator: Vec<u8>,
}
struct BuildTerm {
    key: String,
    entries: Vec<BuildEntry>,
}
struct BlockWriter<'a> {
    file: &'a mut BufWriter<File>,
    path: &'a Path,
    pending: Vec<BuildTerm>,
    directory: Vec<u8>,
    offset: u64,
    blocks: u64,
    terms: u64,
    entries: u64,
    last_key: Option<String>,
}
impl<'a> BlockWriter<'a> {
    fn new(file: &'a mut BufWriter<File>, path: &'a Path) -> Self {
        Self {
            file,
            path,
            pending: Vec::new(),
            directory: Vec::new(),
            offset: HEADER_SIZE as u64,
            blocks: 0,
            terms: 0,
            entries: 0,
            last_key: None,
        }
    }
    // MDX block boundaries alone do not prove that every key is ordered.
    // A false result requests a sorted rebuild.
    fn push(&mut self, key: String, entry: BuildEntry) -> Result<bool> {
        if self.last_key.as_ref().is_some_and(|last| key < *last) {
            return Ok(false);
        }
        if self.last_key.as_ref() != Some(&key) {
            if self.pending.len() == BLOCK_TERMS {
                self.flush_block()?;
            }
            self.pending.push(BuildTerm {
                key: key.clone(),
                entries: Vec::new(),
            });
            self.last_key = Some(key);
            self.terms += 1;
        }
        self.pending.last_mut().unwrap().entries.push(entry);
        self.entries += 1;
        Ok(true)
    }
    fn flush_block(&mut self) -> Result<()> {
        if self.pending.is_empty() {
            return Ok(());
        }
        let base_ordinal = self
            .pending
            .iter()
            .flat_map(|t| &t.entries)
            .map(|e| e.ordinal)
            .min()
            .unwrap();
        let mut bytes = Vec::new();
        write_varint(&mut bytes, base_ordinal);
        let mut previous: &[u8] = &[];
        for term in &self.pending {
            write_text(&mut bytes, previous, term.key.as_bytes());
            previous = term.key.as_bytes();
            let mut postings = Vec::new();
            for entry in &term.entries {
                write_varint(&mut postings, entry.ordinal - base_ordinal);
                write_varint(&mut postings, entry.locator.len() as u64);
                postings.extend_from_slice(&entry.locator);
                // Each posting owns its spelling. Identical spelling costs one byte.
                if entry.display == term.key {
                    write_varint(&mut postings, 0);
                } else {
                    write_varint(&mut postings, entry.display.len() as u64 + 1);
                    write_text(&mut postings, term.key.as_bytes(), entry.display.as_bytes());
                }
            }
            write_varint(&mut bytes, term.entries.len() as u64);
            write_varint(&mut bytes, postings.len() as u64);
            bytes.extend_from_slice(&postings);
        }
        let first_key = self.pending[0].key.as_bytes();
        write_varint(&mut self.directory, first_key.len() as u64);
        self.directory.extend_from_slice(first_key);
        self.directory.extend_from_slice(&self.offset.to_le_bytes());
        self.directory
            .extend_from_slice(&(bytes.len() as u64).to_le_bytes());
        self.directory
            .extend_from_slice(&xxh64(&bytes, 0).to_le_bytes());
        write_varint(&mut self.directory, self.pending.len() as u64);
        self.file
            .write_all(&bytes)
            .map_err(|e| Error::io(self.path, e))?;
        self.offset += bytes.len() as u64;
        self.blocks += 1;
        self.pending.clear();
        Ok(())
    }
    fn finish(mut self, fingerprint: u64, expected_entries: u64) -> Result<BuildResult> {
        if self.entries != expected_entries {
            return Err(Error::invalid(
                self.path,
                0,
                "DIDX source entry count mismatch",
            ));
        }
        self.flush_block()?;
        self.file
            .write_all(&self.directory)
            .map_err(|e| Error::io(self.path, e))?;
        let mut header = [0u8; HEADER_SIZE];
        header[..8].copy_from_slice(&MAGIC);
        header[8..10].copy_from_slice(&(FORMAT_VERSION as u16).to_le_bytes());
        put_u32(&mut header, 12, HEADER_SIZE as u32);
        put_u32(&mut header, 20, NORMALIZATION_VERSION);
        put_u64(&mut header, 24, self.terms);
        put_u64(&mut header, 32, self.entries);
        put_u64(&mut header, 40, self.blocks);
        put_u64(&mut header, 48, self.offset);
        put_u64(&mut header, 56, self.directory.len() as u64);
        put_u32(&mut header, 64, BLOCK_TERMS as u32);
        put_u64(&mut header, 72, xxh64(&self.directory, 0));
        put_u64(&mut header, 80, fingerprint);
        let checksum = xxh64(&header[..88], 0);
        put_u64(&mut header, 88, checksum);
        self.file
            .seek(SeekFrom::Start(0))
            .map_err(|e| Error::io(self.path, e))?;
        self.file
            .write_all(&header)
            .map_err(|e| Error::io(self.path, e))?;
        self.file.flush().map_err(|e| Error::io(self.path, e))?;
        self.file
            .get_ref()
            .sync_all()
            .map_err(|e| Error::io(self.path, e))?;
        Ok(BuildResult {
            entry_count: self.entries,
            term_count: self.terms,
            file_size: self.offset + self.directory.len() as u64,
            format_version: FORMAT_VERSION,
            normalization_version: NORMALIZATION_VERSION,
        })
    }
}
impl DidxIndex {
    /// Build a headword index and atomically publish it. A concurrent writer to
    /// the same destination fails without deleting the other writer's temp file.
    pub fn build(source: &impl IndexSource, output_path: impl AsRef<Path>) -> Result<BuildResult> {
        let output_path = output_path.as_ref();
        let fingerprint = source.fingerprint()?;
        let mut temporary_name = output_path.as_os_str().to_os_string();
        temporary_name.push(".tmp");
        let temporary_path = PathBuf::from(temporary_name);
        if let Some(parent) = output_path.parent().filter(|p| !p.as_os_str().is_empty()) {
            fs::create_dir_all(parent).map_err(|e| Error::io(parent, e))?;
        }
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
            .map_err(|e| Error::io(&temporary_path, e))?;
        // Only remove a temp file this invocation successfully created.
        let result = (|| {
            let mut file = BufWriter::new(file);
            file.write_all(&[0; HEADER_SIZE])
                .map_err(|e| Error::io(&temporary_path, e))?;
            let mut writer = BlockWriter::new(&mut file, &temporary_path);
            let mut ordered = true;
            let mut count = 0;
            for (ordinal, entry) in source.entries()?.enumerate() {
                let entry = entry?;
                check_entry(&entry)?;
                count += 1;
                if !writer.push(
                    normalize(&entry.key_text),
                    BuildEntry {
                        display: entry.key_text,
                        ordinal: ordinal as u64,
                        locator: entry.locator,
                    },
                )? {
                    ordered = false;
                    break;
                }
            }
            if ordered {
                return writer.finish(fingerprint, count);
            }
            drop(writer);
            // Observed source order is incompatible: restart with explicit sort.
            file.flush().map_err(|e| Error::io(&temporary_path, e))?;
            file.get_ref()
                .set_len(HEADER_SIZE as u64)
                .map_err(|e| Error::io(&temporary_path, e))?;
            file.seek(SeekFrom::Start(HEADER_SIZE as u64))
                .map_err(|e| Error::io(&temporary_path, e))?;
            let mut entries = Vec::new();
            for (ordinal, entry) in source.entries()?.enumerate() {
                let entry = entry?;
                check_entry(&entry)?;
                entries.push((
                    normalize(&entry.key_text),
                    BuildEntry {
                        display: entry.key_text,
                        ordinal: ordinal as u64,
                        locator: entry.locator,
                    },
                ));
            }
            let count = entries.len() as u64;
            entries.sort_unstable_by(|a, b| a.0.cmp(&b.0).then(a.1.ordinal.cmp(&b.1.ordinal)));
            let mut writer = BlockWriter::new(&mut file, &temporary_path);
            for (key, entry) in entries {
                writer.push(key, entry)?;
            }
            writer.finish(fingerprint, count)
        })()
        .and_then(|built| {
            // Validate the actual bytes before publication, not just the writer state.
            Self::open(&temporary_path)?.validate()?;
            if source.fingerprint()? != fingerprint {
                return Err(Error::invalid(
                    output_path,
                    0,
                    "DIDX source changed during build",
                ));
            }
            Ok(built)
        });
        match result {
            Ok(built) => {
                if let Err(error) = replace_index_file(&temporary_path, output_path) {
                    let _ = fs::remove_file(&temporary_path);
                    return Err(error);
                }
                Ok(built)
            }
            Err(error) => {
                let _ = fs::remove_file(&temporary_path);
                Err(error)
            }
        }
    }
    /// Verify header/directory integrity and map the file. Blocks are verified
    /// on access; validate() performs an exhaustive offline integrity check.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        let file = File::open(&path).map_err(|e| Error::io(&path, e))?;
        if file.metadata().map_err(|e| Error::io(&path, e))?.len() < HEADER_SIZE as u64 {
            return Err(Error::invalid(&path, 0, "DIDX truncated header"));
        }
        let mmap = unsafe { Mmap::map(&file).map_err(|e| Error::io(&path, e))? };
        if mmap.len() < HEADER_SIZE {
            return Err(Error::invalid(&path, 0, "DIDX truncated header"));
        }
        let mut h = Cursor::new(&mmap[..HEADER_SIZE], &path);
        if h.take(8)? != MAGIC {
            return Err(h.error("invalid DIDX magic"));
        }
        if h.take(4)? != [FORMAT_VERSION as u8, 0, 0, 0] {
            return Err(Error::unsupported("DIDX format changed; rebuild index"));
        }
        if h.u32()? as usize != HEADER_SIZE {
            return Err(h.error("DIDX header size"));
        }
        if h.u32()? != 0 {
            return Err(h.error("DIDX reserved normalization flags"));
        }
        if h.u32()? != NORMALIZATION_VERSION {
            return Err(Error::unsupported(
                "DIDX normalization changed; rebuild index",
            ));
        }
        let terms = h.u64()?;
        let entries = h.u64()?;
        let block_count = h.size64()?;
        let directory_offset = h.size64()?;
        let directory_length = h.size64()?;
        let block_terms = h.u32()? as usize;
        if block_terms == 0 || block_terms > 4096 || h.u32()? != 0 {
            return Err(h.error("DIDX invalid block size or reserved flags"));
        }
        let directory_checksum = h.u64()?;
        let source_fingerprint = h.u64()?;
        if h.u64()? != xxh64(&mmap[..88], 0) {
            return Err(h.error("DIDX header checksum mismatch"));
        }
        if directory_offset < HEADER_SIZE
            || directory_offset.checked_add(directory_length) != Some(mmap.len())
        {
            return Err(h.error("DIDX directory range"));
        }
        let directory = &mmap[directory_offset..];
        if xxh64(directory, 0) != directory_checksum {
            return Err(h.error("DIDX directory checksum mismatch"));
        }
        // Minimum directory entry: length byte, 3 u64s, count byte.
        if block_count > directory_length / 26 || terms > entries {
            return Err(h.error("DIDX impossible counts"));
        }
        let mut d = Cursor::new(directory, &path);
        let mut blocks: Vec<Block> = Vec::with_capacity(block_count);
        let mut next_offset = HEADER_SIZE;
        let mut counted_terms = 0u64;
        for _ in 0..block_count {
            let length = d.size()?;
            let first_key = d.text(length)?.to_owned();
            let offset = d.size64()?;
            let length = d.size64()?;
            let checksum = d.u64()?;
            let count = d.size()?;
            if count == 0 || count > block_terms || length == 0 || offset != next_offset {
                return Err(d.error("DIDX invalid block directory entry"));
            }
            next_offset = offset
                .checked_add(length)
                .filter(|end| *end <= directory_offset)
                .ok_or_else(|| d.error("DIDX block range"))?;
            if blocks.last().is_some_and(|b| b.first_key >= first_key) {
                return Err(d.error("DIDX restart keys are not sorted"));
            }
            counted_terms = counted_terms
                .checked_add(count as u64)
                .ok_or_else(|| d.error("DIDX count overflow"))?;
            blocks.push(Block {
                first_key,
                offset,
                length,
                terms: count,
                checksum,
            });
        }
        if !d.done()
            || counted_terms != terms
            || next_offset != directory_offset
            || ((terms == 0) != (entries == 0))
        {
            return Err(d.error("DIDX inconsistent directory/counts"));
        }
        Ok(Self {
            path,
            mmap,
            blocks,
            metadata: DidxMetadata {
                entry_count: entries,
                term_count: terms,
                source_fingerprint,
                format_version: FORMAT_VERSION,
                normalization_version: NORMALIZATION_VERSION,
            },
        })
    }
    /// Stored header metadata.
    pub fn metadata(&self) -> DidxMetadata {
        self.metadata
    }
    /// Reject a valid but stale index before handing out locators.
    pub fn open_for_source(path: impl AsRef<Path>, fingerprint: u64) -> Result<Self> {
        let index = Self::open(path)?;
        if index.metadata.source_fingerprint != fingerprint {
            return Err(Error::unsupported("DIDX source changed; rebuild index"));
        }
        Ok(index)
    }
    fn block(&self, index: usize) -> Result<BlockCursor<'_>> {
        let block = &self.blocks[index];
        let bytes = &self.mmap[block.offset..block.offset + block.length];
        if xxh64(bytes, 0) != block.checksum {
            return Err(Error::invalid(
                &self.path,
                block.offset as u64,
                "DIDX block checksum mismatch",
            ));
        }
        let mut cursor = Cursor::new(bytes, &self.path);
        let base_ordinal = cursor.varint()?;
        Ok(BlockCursor {
            cursor,
            base_ordinal,
            remaining: block.terms,
            key: Vec::new(),
            first: true,
            first_key: &block.first_key,
            next_key: self.blocks.get(index + 1).map(|b| b.first_key.as_str()),
        })
    }
    fn start_block(&self, query: &str) -> usize {
        self.blocks
            .partition_point(|b| b.first_key.as_str() <= query)
            .saturating_sub(1)
    }
    /// Original spelling first, then Unicode case-equivalent records. No default truncation.
    pub fn exact(&self, query: &str, limit: Option<usize>) -> Result<Vec<IndexMatch>> {
        let mut hits = self.search(query, None, false)?;
        hits.retain(|hit| rank(query, &hit.key_text) <= MatchKind::CaseInsensitive);
        for hit in &mut hits {
            hit.match_kind = rank(query, &hit.key_text);
        }
        hits.sort_by_key(|hit| (hit.match_kind, hit.key_ordinal));
        if let Some(limit) = limit {
            hits.truncate(limit);
        }
        Ok(hits)
    }
    /// Accent/punctuation/spacing alternatives, kept separate from exact records.
    pub fn loose(&self, query: &str, limit: Option<usize>) -> Result<Vec<IndexMatch>> {
        let mut hits = self.search(query, None, false)?;
        hits.retain(|hit| rank(query, &hit.key_text) == MatchKind::Loose);
        for hit in &mut hits {
            hit.match_kind = MatchKind::Loose;
        }
        hits.truncate(normalize_limit(limit));
        Ok(hits)
    }
    /// Prefix match: rank at most 5 * limit matching normalized terms (1000 without a limit).
    /// Returns one physical representative per normalized term.
    pub fn prefix(&self, query: &str, limit: Option<usize>) -> Result<Vec<IndexMatch>> {
        check_query(query)?;
        let scan_limit = limit.map_or(1000, |limit| limit.saturating_mul(5));
        let limit = normalize_limit(limit);
        let original = query.trim();
        let query = normalize(original);
        if query.is_empty() || limit == 0 {
            return Ok(Vec::new());
        }
        let mut best = BinaryHeap::new();
        let mut scanned = 0;
        'blocks: for index in self.start_block(&query)..self.blocks.len() {
            let mut block = self.block(index)?;
            while let Some(term) = block.next()? {
                if term.key < query {
                    continue;
                }
                if !term.key.starts_with(&query) {
                    break 'blocks;
                }
                let mut postings = Cursor::new(term.postings, &self.path);
                let mut representative = None;
                for _ in 0..term.count {
                    let (ordinal, locator, display) = self.read_posting_fields(&term, &mut postings)?;
                    let kind = rank(original, &display);
                    if representative
                        .as_ref()
                        .is_none_or(|(best_kind, best_ordinal, _, _)| {
                            (kind, ordinal) < (*best_kind, *best_ordinal)
                        })
                    {
                        representative = Some((kind, ordinal, display, locator));
                    }
                }
                let (kind, ordinal, display, locator) = representative.unwrap();
                // Keep the locator borrowed from the mmap until the final Top-K is known.
                best.push((
                    kind,
                    display.chars().count(),
                    term.key,
                    display,
                    ordinal,
                    locator,
                ));
                if best.len() > limit {
                    best.pop();
                }
                scanned += 1;
                if scanned >= scan_limit {
                    break 'blocks;
                }
            }
        }
        Ok(best
            .into_sorted_vec()
            .into_iter()
            .map(|(kind, _, normalized_key, key_text, key_ordinal, locator)| IndexMatch {
                key_text,
                normalized_key,
                key_ordinal,
                locator: locator.to_vec(),
                match_kind: kind,
                distance: None,
            })
            .collect())
    }
    fn search(&self, query: &str, limit: Option<usize>, prefix: bool) -> Result<Vec<IndexMatch>> {
        check_query(query)?;
        let original = query.trim();
        let query = normalize(original);
        let limit = if prefix {
            normalize_limit(limit)
        } else {
            limit.unwrap_or(usize::MAX)
        };
        if query.is_empty() || limit == 0 {
            return Ok(Vec::new());
        }
        let mut output = Vec::new();
        for index in self.start_block(&query)..self.blocks.len() {
            let mut block = self.block(index)?;
            while let Some(term) = block.next()? {
                if term.key.as_str() < query.as_str() {
                    continue;
                }
                if (prefix && !term.key.starts_with(&query)) || (!prefix && term.key != query) {
                    return Ok(output);
                }
                if prefix {
                    let mut hits = Vec::new();
                    self.append(&term, usize::MAX, &mut hits)?;
                    let mut hit = hits
                        .into_iter()
                        .min_by_key(|hit| (rank(original, &hit.key_text), hit.key_ordinal))
                        .unwrap();
                    hit.match_kind = rank(original, &hit.key_text);
                    output.push(hit);
                } else {
                    self.append(&term, limit, &mut output)?;
                }
                if !prefix || output.len() >= limit {
                    return Ok(output);
                }
            }
        }
        Ok(output)
    }
    /// Unicode Levenshtein search with shared-prefix DP and bounded top-k storage.
    pub fn fuzzy(
        &self,
        query: &str,
        max_distance: Option<usize>,
        limit: Option<usize>,
    ) -> Result<Vec<IndexMatch>> {
        check_query(query)?;
        if query.chars().count() > 256 {
            return Err(Error::unsupported(
                "DIDX fuzzy query exceeds 256 characters",
            ));
        }
        let query = normalize(query);
        let maximum = max_distance.unwrap_or(default_fuzzy_distance(&query));
        if maximum > MAX_FUZZY_DISTANCE {
            return Err(Error::unsupported("DIDX fuzzy distance exceeds 4"));
        }
        let limit = normalize_limit(limit);
        if query.is_empty() || limit == 0 {
            return Ok(Vec::new());
        }
        let mut matcher = FuzzyMatcher::new(&query, maximum);
        let mut best = BinaryHeap::new();
        let mut best_distance = maximum + 1;
        let mut index = 0;
        let mut skip_until: Vec<u8> = Vec::new();
        while index < self.blocks.len() {
            // A rejected trie prefix describes a contiguous byte range. Jump
            // across whole blocks in that range using the sparse directory.
            if !skip_until.is_empty() {
                let target = self
                    .blocks
                    .partition_point(|b| b.first_key.as_bytes() < skip_until.as_slice())
                    .saturating_sub(1);
                index = index.max(target);
            }
            let mut block = self.block(index)?;
            let mut term_index = 0;
            while let Some(term) = block.next()? {
                let current_term = term_index;
                term_index += 1;
                if term.key.as_bytes() < skip_until.as_slice() {
                    continue;
                }
                let distance = matcher.distance(&term.key);
                if let Some(prefix) = matcher.rejected_prefix() {
                    skip_until = prefix.into_bytes();
                    // UTF-8 never contains 0xff, so a byte successor always exists.
                    *skip_until.last_mut().unwrap() += 1;
                    if self
                        .blocks
                        .get(index + 1)
                        .is_some_and(|b| b.first_key.as_bytes() < skip_until.as_slice())
                    {
                        break;
                    }
                }
                if distance <= maximum {
                    let shared_prefix = shared_prefix_length(&query, &term.key);
                    if shared_prefix == 0 {
                        continue;
                    }
                    if distance < best_distance {
                        best.clear();
                        best_distance = distance;
                    } else if distance > best_distance {
                        continue;
                    }
                    let length_difference = query
                        .chars()
                        .count()
                        .abs_diff(term.key.chars().count());
                    best.push((
                        distance,
                        Reverse(shared_prefix),
                        length_difference,
                        term.key,
                        index,
                        current_term,
                    ));
                    if best.len() > limit {
                        best.pop();
                    }
                }
            }
            index += 1;
        }
        let mut output = Vec::new();
        for (distance, _, _, _, index, term_index) in best.into_sorted_vec() {
            let mut block = self.block(index)?;
            for i in 0..=term_index {
                let term = block.next()?.unwrap();
                if i == term_index {
                    self.append(&term, 1, &mut output)?;
                    let hit = output.last_mut().unwrap();
                    hit.match_kind = MatchKind::Fuzzy;
                    hit.distance = Some(distance as u32);
                }
            }
        }
        Ok(output)
    }
    /// Candidate stage: exact, loose/prefix, then spelling suggestions when space remains.
    pub fn candidates(&self, query: &str, limit: Option<usize>) -> Result<Vec<IndexMatch>> {
        let limit = normalize_limit(limit);
        if limit == 0 {
            return Ok(Vec::new());
        }
        let mut hits = self.exact(query, None)?;
        hits.extend(self.loose(query, Some(limit))?);
        hits.extend(self.prefix(query, Some(limit))?);
        hits.sort_by(|a, b| {
            let kind_order = a.match_kind.cmp(&b.match_kind);
            if !kind_order.is_eq() {
                return kind_order;
            }
            if a.match_kind == MatchKind::Prefix {
                let length_order = a.key_text.chars().count().cmp(&b.key_text.chars().count());
                if !length_order.is_eq() {
                    return length_order;
                }
            }
            (a.match_kind, &a.normalized_key, &a.key_text, a.key_ordinal).cmp(&(
                b.match_kind,
                &b.normalized_key,
                &b.key_text,
                b.key_ordinal,
            ))
        });
        let mut seen = std::collections::HashSet::new();
        hits.retain(|hit| seen.insert(hit.key_text.clone()));
        hits.truncate(limit);
        if hits.len() < limit && query.chars().count() <= 256 {
            // Short inputs need a tighter threshold to avoid noisy unrelated words.
            for hit in self.fuzzy(query, None, Some(limit))? {
                if seen.insert(hit.key_text.clone()) {
                    hits.push(hit);
                }
                if hits.len() == limit {
                    break;
                }
            }
        }
        Ok(hits)
    }
    /// Full-headword glob: ? is one Unicode scalar, * is zero or more. Backslash escapes literals.
    pub fn wildcard(&self, pattern: &str, limit: Option<usize>) -> Result<Vec<IndexMatch>> {
        check_query(pattern)?;
        let trimmed_pattern = pattern.trim_start();
        if trimmed_pattern.starts_with('*') || trimmed_pattern.starts_with('?') {
            return Err(Error::unsupported(
                "DIDX wildcard must start with a literal prefix",
            ));
        }
        if pattern.chars().count() > 256 {
            return Err(Error::unsupported("DIDX wildcard exceeds 256 characters"));
        }
        let limit = normalize_limit(limit);
        if pattern.trim().is_empty() || limit == 0 {
            return Ok(Vec::new());
        }
        let tokens = matching::parse_pattern(pattern)?;
        let prefix = wildcard_prefix(&tokens);
        let mut output = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for index in self.start_block(&prefix)..self.blocks.len() {
            let mut block = self.block(index)?;
            while let Some(term) = block.next()? {
                if term.key < prefix {
                    continue;
                }
                if !prefix.is_empty() && !term.key.starts_with(&prefix) {
                    return Ok(output);
                }
                let mut hits = Vec::new();
                self.append(&term, usize::MAX, &mut hits)?;
                hits.sort_by(|a, b| {
                    (&a.key_text, a.key_ordinal).cmp(&(&b.key_text, b.key_ordinal))
                });
                for mut hit in hits {
                    if wildcard_matches(&tokens, &hit.key_text) && seen.insert(hit.key_text.clone())
                    {
                        hit.match_kind = MatchKind::Wildcard;
                        output.push(hit);
                        if output.len() == limit {
                            return Ok(output);
                        }
                    }
                }
            }
        }
        Ok(output)
    }
    fn append(&self, term: &Term<'_>, maximum: usize, output: &mut Vec<IndexMatch>) -> Result<()> {
        let mut cursor = Cursor::new(term.postings, &self.path);
        for _ in 0..term.count.min(maximum) {
            output.push(self.read_posting(term, &mut cursor)?);
        }
        Ok(())
    }
    fn read_posting(&self, term: &Term<'_>, cursor: &mut Cursor<'_>) -> Result<IndexMatch> {
        let (ordinal, locator, display) = self.read_posting_fields(term, cursor)?;
        Ok(IndexMatch {
            key_text: display,
            normalized_key: term.key.clone(),
            key_ordinal: ordinal,
            locator: locator.to_vec(),
            match_kind: MatchKind::Exact,
            distance: None,
        })
    }
    fn read_posting_fields<'a>(
        &self,
        term: &Term<'_>,
        cursor: &mut Cursor<'a>,
    ) -> Result<(u64, &'a [u8], String)> {
        let ordinal = cursor
            .varint()?
            .checked_add(term.base_ordinal)
            .filter(|n| *n < self.metadata.entry_count)
            .ok_or_else(|| cursor.error("DIDX ordinal out of range"))?;
        let locator_size = cursor.size()?;
        if !(1..=4096).contains(&locator_size) {
            return Err(cursor.error("DIDX invalid locator length"));
        }
        let locator = cursor.take(locator_size)?;
        let display_size = cursor.size()?;
        if display_size > 65_537 {
            return Err(cursor.error("DIDX display too long"));
        }
        let display = if display_size == 0 {
            term.key.clone()
        } else {
            let mut display = term.key.as_bytes().to_vec();
            cursor.front_text(&mut display)?;
            if display.len() != display_size - 1 {
                return Err(cursor.error("DIDX display length mismatch"));
            }
            String::from_utf8(display).map_err(|_| cursor.error("DIDX invalid display UTF-8"))?
        };
        Ok((ordinal, locator, display))
    }
    /// Fully check blocks, per-record spellings, normalization and locator counts.
    pub fn validate(&self) -> Result<()> {
        let mut entries = 0u64;
        for index in 0..self.blocks.len() {
            let mut block = self.block(index)?;
            while let Some(term) = block.next()? {
                let mut postings = Cursor::new(term.postings, &self.path);
                let mut previous_ordinal = None;
                for _ in 0..term.count {
                    let hit = self.read_posting(&term, &mut postings)?;
                    if normalize(&hit.key_text) != term.key
                        || previous_ordinal.is_some_and(|n| n >= hit.key_ordinal)
                    {
                        return Err(postings.error("DIDX spelling/order mismatch"));
                    }
                    previous_ordinal = Some(hit.key_ordinal);
                    entries += 1;
                }
                if !postings.done() {
                    return Err(postings.error("DIDX trailing posting bytes"));
                }
            }
        }
        if entries != self.metadata.entry_count {
            return Err(Error::invalid(&self.path, 0, "DIDX entry count mismatch"));
        }
        Ok(())
    }
}
struct Term<'a> {
    key: String,
    count: usize,
    postings: &'a [u8],
    base_ordinal: u64,
}
struct BlockCursor<'a> {
    cursor: Cursor<'a>,
    base_ordinal: u64,
    remaining: usize,
    key: Vec<u8>,
    first: bool,
    first_key: &'a str,
    next_key: Option<&'a str>,
}
impl<'a> BlockCursor<'a> {
    fn next(&mut self) -> Result<Option<Term<'a>>> {
        if self.remaining == 0 {
            if !self.cursor.done() {
                return Err(self.cursor.error("DIDX trailing block bytes"));
            }
            return Ok(None);
        }
        self.cursor.sorted_front_text(&mut self.key, self.first)?;
        let key = std::str::from_utf8(&self.key)
            .map_err(|_| self.cursor.error("DIDX invalid key UTF-8"))?;
        if (self.first && key != self.first_key) || self.next_key.is_some_and(|next| key >= next) {
            return Err(self.cursor.error("DIDX key order/restart mismatch"));
        }
        self.first = false;
        let count = self.cursor.size()?;
        let length = self.cursor.size()?;
        let postings = self.cursor.take(length)?;
        if count == 0 || count > length / 4 {
            return Err(self.cursor.error("DIDX impossible posting count"));
        }
        self.remaining -= 1;
        Ok(Some(Term {
            key: key.to_owned(),
            count,
            postings,
            base_ordinal: self.base_ordinal,
        }))
    }
}
// Unicode DP reuses rows for shared prefixes and prunes impossible subtrees.
struct FuzzyMatcher {
    query: Vec<char>,
    maximum: usize,
    previous: Vec<char>,
    rows: Vec<Vec<usize>>,
}
impl FuzzyMatcher {
    fn rejected_prefix(&self) -> Option<String> {
        if self.rows.last().unwrap().iter().all(|n| *n > self.maximum) {
            Some(self.previous[..self.rows.len() - 1].iter().collect())
        } else {
            None
        }
    }
    fn new(query: &str, maximum: usize) -> Self {
        let query: Vec<_> = query.chars().collect();
        let first = (0..=query.len()).collect();
        Self {
            query,
            maximum,
            previous: Vec::new(),
            rows: vec![first],
        }
    }
    fn distance(&mut self, key: &str) -> usize {
        let chars: Vec<char> = key.chars().collect();
        let shared = chars
            .iter()
            .zip(&self.previous)
            .take_while(|(a, b)| a == b)
            .count()
            .min(self.rows.len() - 1);
        self.rows.truncate(shared + 1);
        self.previous = chars;
        if self.rows[shared].iter().all(|n| *n > self.maximum) {
            return self.maximum + 1;
        }
        for i in shared..self.previous.len() {
            let previous = &self.rows[i];
            let mut row = vec![self.maximum + 1; self.query.len() + 1];
            row[0] = i + 1;
            let from = (i + 1).saturating_sub(self.maximum).max(1);
            let to = (i + 1 + self.maximum).min(self.query.len());
            for j in from..=to {
                row[j] = (previous[j] + 1)
                    .min(row[j - 1] + 1)
                    .min(previous[j - 1] + usize::from(self.previous[i] != self.query[j - 1]));
            }
            let impossible = row.iter().all(|n| *n > self.maximum);
            self.rows.push(row);
            if impossible {
                return self.maximum + 1;
            }
        }
        self.rows.last().unwrap()[self.query.len()]
    }
}

fn default_fuzzy_distance(query: &str) -> usize {
    match query.chars().count() {
        0..=4 => 1,
        5..=8 => 2,
        _ => 3,
    }
}

fn shared_prefix_length(left: &str, right: &str) -> usize {
    left.chars()
        .zip(right.chars())
        .take_while(|(left, right)| left == right)
        .count()
}

struct Cursor<'a> {
    bytes: &'a [u8],
    pos: usize,
    path: &'a Path,
}
impl<'a> Cursor<'a> {
    fn new(bytes: &'a [u8], path: &'a Path) -> Self {
        Self {
            bytes,
            pos: 0,
            path,
        }
    }
    fn error(&self, message: &str) -> Error {
        Error::invalid(self.path, self.pos as u64, message)
    }
    fn done(&self) -> bool {
        self.pos == self.bytes.len()
    }
    fn take(&mut self, length: usize) -> Result<&'a [u8]> {
        let end = self
            .pos
            .checked_add(length)
            .ok_or_else(|| self.error("DIDX range overflow"))?;
        let bytes = self
            .bytes
            .get(self.pos..end)
            .ok_or_else(|| self.error("DIDX truncated data"))?;
        self.pos = end;
        Ok(bytes)
    }
    fn text(&mut self, length: usize) -> Result<&'a str> {
        std::str::from_utf8(self.take(length)?).map_err(|_| self.error("DIDX invalid UTF-8"))
    }
    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn u64(&mut self) -> Result<u64> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn size64(&mut self) -> Result<usize> {
        usize::try_from(self.u64()?).map_err(|_| self.error("DIDX size exceeds address space"))
    }
    fn varint(&mut self) -> Result<u64> {
        let mut value = 0;
        for shift in (0..=63).step_by(7) {
            let byte = self.take(1)?[0];
            if shift == 63 && byte > 1 {
                return Err(self.error("DIDX varint overflow"));
            }
            value |= u64::from(byte & 127) << shift;
            if byte & 128 == 0 {
                return Ok(value);
            }
        }
        Err(self.error("DIDX varint overflow"))
    }
    fn size(&mut self) -> Result<usize> {
        usize::try_from(self.varint()?).map_err(|_| self.error("DIDX size exceeds address space"))
    }
    fn front_text(&mut self, previous: &mut Vec<u8>) -> Result<()> {
        let shared = self.size()?;
        let length = self.size()?;
        if shared > previous.len() {
            return Err(self.error("DIDX invalid shared prefix"));
        }
        let suffix = self.take(length)?;
        previous.truncate(shared);
        previous.extend_from_slice(suffix);
        Ok(())
    }
    fn sorted_front_text(&mut self, previous: &mut Vec<u8>, first: bool) -> Result<()> {
        let shared = self.size()?;
        let length = self.size()?;
        if shared > previous.len() {
            return Err(self.error("DIDX invalid shared prefix"));
        }
        let suffix = self.take(length)?;
        // Equal shared bytes can be ignored when checking lexical order.
        if !first && &previous[shared..] >= suffix {
            return Err(self.error("DIDX keys are not sorted"));
        }
        previous.truncate(shared);
        previous.extend_from_slice(suffix);
        Ok(())
    }
}
fn normalize_limit(limit: Option<usize>) -> usize {
    limit.unwrap_or(50).min(MAX_LIMIT)
}
fn check_query(query: &str) -> Result<()> {
    if query.len() > 65_536 {
        return Err(Error::unsupported("DIDX query exceeds 65536 bytes"));
    }
    Ok(())
}
fn check_entry(entry: &IndexEntry) -> Result<()> {
    if entry.key_text.len() > 65_536 || entry.locator.is_empty() || entry.locator.len() > 4096 {
        return Err(Error::unsupported("DIDX invalid headword or locator size"));
    }
    Ok(())
}
fn write_varint(bytes: &mut Vec<u8>, mut value: u64) {
    while value >= 128 {
        bytes.push(value as u8 | 128);
        value >>= 7;
    }
    bytes.push(value as u8);
}
fn write_text(bytes: &mut Vec<u8>, previous: &[u8], text: &[u8]) {
    let shared = previous
        .iter()
        .zip(text)
        .take_while(|(a, b)| a == b)
        .count();
    write_varint(bytes, shared as u64);
    write_varint(bytes, (text.len() - shared) as u64);
    bytes.extend_from_slice(&text[shared..]);
}
fn put_u32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}
fn put_u64(bytes: &mut [u8], offset: usize, value: u64) {
    bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}
#[cfg(not(windows))]
fn replace_index_file(temporary_path: &Path, output_path: &Path) -> Result<()> {
    fs::rename(temporary_path, output_path).map_err(|e| Error::io(output_path, e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Mdict, decode_mdx_locator};

    #[test]
    fn default_fuzzy_distance_uses_query_length_bands() {
        assert_eq!(default_fuzzy_distance("abcd"), 1);
        assert_eq!(default_fuzzy_distance("abcde"), 2);
        assert_eq!(default_fuzzy_distance("abcdefgh"), 2);
        assert_eq!(default_fuzzy_distance("abcdefghi"), 3);
    }

    // Standalone generated MDX keeps the writer regression runnable without the
    // locally ignored integration fixtures or downloaded dictionaries.
    fn source_fixture(keys: &[&str]) -> Vec<u8> {
        fn envelope(data: &[u8]) -> Vec<u8> {
            let mut z = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::fast());
            z.write_all(data).unwrap();
            let mut result = 2u32.to_le_bytes().to_vec();
            result.extend_from_slice(&adler2::adler32_slice(data).to_be_bytes());
            result.extend(z.finish().unwrap());
            result
        }
        let header: Vec<u8> = r#"<Dictionary GeneratedByEngineVersion="2.0" RequiredEngineVersion="2.0" Encoding="UTF-8" Encrypted="No" KeyCaseSensitive="No" StripKey="Yes" Title="DIDX test"/>"#
            .encode_utf16().flat_map(u16::to_le_bytes).collect();
        let mut records = Vec::new();
        let mut key_data = Vec::new();
        for key in keys {
            key_data.extend_from_slice(&(records.len() as u64).to_be_bytes());
            key_data.extend_from_slice(key.as_bytes());
            key_data.push(0);
            records.extend_from_slice(b"DEFINITION_ONLY_SENTINEL");
        }
        let key_block = envelope(&key_data);
        let record_block = envelope(&records);
        let mut info = (keys.len() as u64).to_be_bytes().to_vec();
        for key in [keys[0], keys[keys.len() - 1]] {
            info.extend_from_slice(&(key.len() as u16).to_be_bytes());
            info.extend_from_slice(key.as_bytes());
            info.push(0);
        }
        info.extend_from_slice(&(key_block.len() as u64).to_be_bytes());
        info.extend_from_slice(&(key_data.len() as u64).to_be_bytes());
        let info_block = envelope(&info);
        let mut output = (header.len() as u32).to_be_bytes().to_vec();
        output.extend_from_slice(&header);
        output.extend_from_slice(&adler2::adler32_slice(&header).to_le_bytes());
        let mut parameters = Vec::new();
        for n in [
            1,
            keys.len() as u64,
            info.len() as u64,
            info_block.len() as u64,
            key_block.len() as u64,
        ] {
            parameters.extend_from_slice(&n.to_be_bytes());
        }
        output.extend_from_slice(&parameters);
        output.extend_from_slice(&adler2::adler32_slice(&parameters).to_be_bytes());
        output.extend(info_block);
        output.extend(key_block);
        for n in [
            1,
            keys.len() as u64,
            16,
            record_block.len() as u64,
            record_block.len() as u64,
            records.len() as u64,
        ] {
            output.extend_from_slice(&n.to_be_bytes());
        }
        output.extend(record_block);
        output
    }

    #[test]
    fn builds_unsorted_mdx_losslessly_and_owns_only_its_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.mdx");
        let output = dir.path().join("index.didx");
        let keys = ["A-b", "Beta", "a.b", "ab", "中文"];
        fs::write(&source, source_fixture(&keys)).unwrap();
        let mdx = Mdict::open(&source).unwrap();
        DidxIndex::build_from_mdx(&mdx, &output).unwrap();
        let index = DidxIndex::open(&output).unwrap();
        index.validate().unwrap();
        for (ordinal, key) in mdx.keys().enumerate() {
            let key = key.unwrap();
            assert!(
                index
                    .exact(&key.text, None)
                    .unwrap()
                    .iter()
                    .any(|hit| hit.key_ordinal == ordinal as u64
                        && hit.key_text == key.text
                        && decode_mdx_locator(&hit.locator).unwrap()
                            == (key.record_start, key.record_end))
            );
        }
        assert_eq!(index.exact("ab", None).unwrap().len(), 1);
        assert_eq!(index.loose("ab", None).unwrap().len(), 2);
        drop(index);
        let before = fs::read(&output).unwrap();
        assert!(!before.windows(24).any(|w| w == b"DEFINITION_ONLY_SENTINEL"));
        DidxIndex::build_from_mdx(&mdx, &output).unwrap();
        assert_eq!(fs::read(&output).unwrap(), before);
        let tmp = dir.path().join("index.didx.tmp");
        fs::write(&tmp, b"other writer").unwrap();
        assert!(DidxIndex::build_from_mdx(&mdx, &output).is_err());
        assert_eq!(fs::read(tmp).unwrap(), b"other writer");
        assert_eq!(fs::read(&output).unwrap(), before);
        assert!(DidxIndex::build_from_mdx(&mdx, &source).is_err());
    }

    // Independent scalar oracle, deliberately without prefix sharing or banding.
    fn distance(a: &str, b: &str) -> usize {
        let b: Vec<_> = b.chars().collect();
        let mut row: Vec<usize> = (0..=b.len()).collect();
        for (i, x) in a.chars().enumerate() {
            let mut next = vec![i + 1; b.len() + 1];
            for (j, y) in b.iter().enumerate() {
                next[j + 1] = (next[j] + 1)
                    .min(row[j + 1] + 1)
                    .min(row[j] + usize::from(x != *y));
            }
            row = next;
        }
        row[b.len()]
    }

    fn words() -> Vec<String> {
        let mut words = vec![String::new()];
        for _ in 0..5 {
            let next: Vec<_> = words
                .iter()
                .flat_map(|s| ['a', 'b', 'e', '中'].map(|c| format!("{s}{c}")))
                .collect();
            words.extend(next);
            words.sort();
            words.dedup();
        }
        words
    }

    fn fixture(keys: &[String]) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.didx");
        let mut file = BufWriter::new(File::create(&path).unwrap());
        file.write_all(&[0; HEADER_SIZE]).unwrap();
        let mut writer = BlockWriter::new(&mut file, &path);
        for (ordinal, key) in keys.iter().enumerate() {
            // Exercise >4 GiB logical record offsets, including near u64::MAX.
            let start = u64::MAX - 100_000 + ordinal as u64 * 3;
            assert!(
                writer
                    .push(
                        key.clone(),
                        BuildEntry {
                            display: key.clone(),
                            ordinal: ordinal as u64,
                            locator: start.to_le_bytes().to_vec(),
                        }
                    )
                    .unwrap()
            );
        }
        writer.finish(123, keys.len() as u64).unwrap();
        (dir, path)
    }

    #[test]
    fn prefix_ranks_only_the_bounded_matching_range() {
        let mut keys = vec!["0".to_string()];
        keys.extend((0..4).map(|i| format!("aa{i}long")));
        keys.extend(["abx".to_string(), "ac".to_string()]);
        let (_dir, path) = fixture(&keys);
        let index = DidxIndex::open(path).unwrap();
        let words = |limit| {
            index
                .prefix("a", Some(limit))
                .unwrap()
                .into_iter()
                .map(|hit| hit.key_text)
                .collect::<Vec<_>>()
        };
        assert!(words(0).is_empty());
        assert_eq!(words(1), ["abx"]);
        assert_eq!(words(2), ["ac", "abx"]);
        assert_eq!(index.exact("ac", None).unwrap()[0].key_text, "ac");
    }

    #[test]
    fn prefix_without_limit_scans_one_thousand_terms_and_returns_fifty() {
        let mut keys: Vec<_> = (0..999).map(|i| format!("aa{i:04}long")).collect();
        keys.extend(["aby".to_string(), "az".to_string()]);
        let (_dir, path) = fixture(&keys);
        let index = DidxIndex::open(path).unwrap();
        let hits = index.prefix("a", None).unwrap();
        assert_eq!(hits.len(), 50);
        assert_eq!(hits[0].key_text, "aby");
        assert!(!hits.iter().any(|hit| hit.key_text == "az"));
        assert_eq!(index.prefix("a", Some(201)).unwrap()[0].key_text, "az");
    }

    #[test]
    fn prefix_preserves_representative_ranking_and_locators() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("prefix.didx");
        struct Source {
            entries: Vec<IndexEntry>,
        }
        impl IndexSource for Source {
            fn fingerprint(&self) -> Result<u64> {
                Ok(42)
            }
            fn entries(&self) -> Result<Box<dyn Iterator<Item = Result<IndexEntry>> + '_>> {
                Ok(Box::new(self.entries.iter().cloned().map(Ok)))
            }
        }
        let words = [
            "ca-fe", "CAFE", "cafe", "café", "cafe", "cafes", "cafeteria", "caff",
        ];
        let source = Source {
            entries: words
                .iter()
                .enumerate()
                .map(|(i, word)| IndexEntry {
                    key_text: (*word).into(),
                    locator: vec![0xff, i as u8, 0, 0x80],
                })
                .collect(),
        };
        DidxIndex::build(&source, &path).unwrap();
        let index = DidxIndex::open(path).unwrap();
        for (query, representative, ordinal, kind) in [
            ("ca", "ca-fe", 0, MatchKind::Prefix),
            ("cafe", "cafe", 2, MatchKind::Exact),
            ("Cafe", "CAFE", 1, MatchKind::CaseInsensitive),
            ("café", "café", 3, MatchKind::Exact),
            ("ca fe", "ca-fe", 0, MatchKind::Loose),
        ] {
            let hits = index.prefix(query, Some(50)).unwrap();
            let hit = hits
                .iter()
                .find(|hit| hit.normalized_key == "cafe")
                .unwrap();
            assert_eq!(hit.key_text, representative);
            assert_eq!(hit.key_ordinal, ordinal as u64);
            assert_eq!(hit.match_kind, kind);
            assert_eq!(hit.locator, source.entries[ordinal].locator);
            assert_eq!(hit.distance, None);
        }
        let hits = index.prefix("ca", Some(50)).unwrap();
        assert_eq!(
            hits.iter().map(|hit| hit.key_text.as_str()).collect::<Vec<_>>(),
            ["caff", "ca-fe", "cafes", "cafeteria"]
        );
    }

    #[test]
    fn bounded_prefix_matches_independent_oracle() {
        let keys = words();
        let (_dir, path) = fixture(&keys);
        let index = DidxIndex::open(path).unwrap();
        for query in ["a", "é", "中", "abé", "b中", "x", "aaaaaa"] {
            for limit in [0, 1, 7, 100] {
                let mut expected: Vec<_> = keys
                    .iter()
                    .filter(|k| k.starts_with(&normalize(query)))
                    .take(5 * limit)
                    .cloned()
                    .collect();
                expected.sort_by_key(|key| (rank(query, key), key.chars().count(), key.clone()));
                expected.truncate(limit);
                let got: Vec<_> = index
                    .prefix(query, Some(limit))
                    .unwrap()
                    .into_iter()
                    .map(|m| m.key_text)
                    .collect();
                assert_eq!(got, expected, "prefix {query}");
            }
        }
    }

    #[test]
    fn block_queries_match_independent_oracles() {
        let keys = words();
        let (_dir, path) = fixture(&keys);
        let index = DidxIndex::open(path).unwrap();
        index.validate().unwrap();
        for key in keys.iter().filter(|k| !k.is_empty()) {
            assert_eq!(index.exact(key, None).unwrap()[0].key_text, *key);
        }
        for query in ["a", "é", "中", "abé", "b中", "x", "aaaaaa"] {
            for limit in [0, 1, 7, 100] {
                for maximum in 0..=4 {
                    let normalized_query = normalize(query);
                    let mut expected: Vec<_> = keys
                        .iter()
                        .map(|key| {
                            let normalized_key = normalize(key);
                            (
                                distance(&normalized_query, &normalized_key),
                                Reverse(shared_prefix_length(&normalized_query, &normalized_key)),
                                normalized_query
                                    .chars()
                                    .count()
                                    .abs_diff(normalized_key.chars().count()),
                                normalized_key,
                                key.clone(),
                            )
                        })
                        .filter(|(d, shared, _, _, _)| *d <= maximum && shared.0 > 0)
                        .collect();
                    expected.sort();
                    let expected: Vec<_> = expected
                        .into_iter()
                        .take(limit)
                        .map(|(_, _, _, _, key)| key)
                        .collect();
                    let got: Vec<_> = index
                        .fuzzy(query, Some(maximum), Some(limit))
                        .unwrap()
                        .into_iter()
                        .map(|m| m.key_text)
                        .collect();
                    assert_eq!(
                        got, expected,
                        "fuzzy {query} distance={maximum} limit={limit}"
                    );
                }
            }
        }
    }

    #[test]
    fn front_coding_keeps_split_utf8_prefixes_and_varints_lossless() {
        let path = Path::new("test");
        let mut bytes = Vec::new();
        for value in [0, 127, 128, u32::MAX as u64, 1u64 << 63, u64::MAX] {
            write_varint(&mut bytes, value);
        }
        let mut cursor = Cursor::new(&bytes, path);
        for value in [0, 127, 128, u32::MAX as u64, 1u64 << 63, u64::MAX] {
            assert_eq!(cursor.varint().unwrap(), value);
        }
        assert!(Cursor::new(&[255; 10], path).varint().is_err());
        assert!(Cursor::new(&[128], path).varint().is_err());
        let mut bytes = Vec::new();
        write_text(&mut bytes, "é".as_bytes(), "ê".as_bytes());
        let mut text = "é".as_bytes().to_vec();
        Cursor::new(&bytes, path).front_text(&mut text).unwrap();
        assert_eq!(String::from_utf8(text).unwrap(), "ê");
    }

    #[test]
    fn rejects_truncation_and_corruption_at_each_storage_layer() {
        let (_dir, path) = fixture(&words());
        let bytes = fs::read(&path).unwrap();
        for length in [0, 1, 95, 96, bytes.len() / 2, bytes.len() - 1] {
            fs::write(&path, &bytes[..length]).unwrap();
            assert!(DidxIndex::open(&path).is_err());
        }
        for offset in [0, 16, 48, 88, 96, 100, bytes.len() - 1] {
            let mut corrupt = bytes.clone();
            corrupt[offset] ^= 0x40;
            fs::write(&path, corrupt).unwrap();
            assert!(DidxIndex::open(&path).and_then(|i| i.validate()).is_err());
        }
        // Header checksum alone must not permit overlapping/out-of-file sections.
        let mut corrupt = bytes.clone();
        put_u64(&mut corrupt, 48, u64::MAX);
        let hash = xxh64(&corrupt[..88], 0);
        put_u64(&mut corrupt, 88, hash);
        fs::write(&path, corrupt).unwrap();
        assert!(DidxIndex::open(&path).is_err());
        let mut legacy = bytes;
        legacy[8] = 1;
        fs::write(&path, legacy).unwrap();
        assert!(matches!(
            DidxIndex::open(&path),
            Err(Error::Unsupported { .. })
        ));
    }
}
#[cfg(windows)]
fn replace_index_file(temporary_path: &Path, output_path: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }
    let old: Vec<u16> = temporary_path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let new: Vec<u16> = output_path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    if unsafe { MoveFileExW(old.as_ptr(), new.as_ptr(), 1 | 8) } == 0 {
        return Err(Error::io(output_path, std::io::Error::last_os_error()));
    }
    Ok(())
}
