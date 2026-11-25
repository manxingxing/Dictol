//! Read-only capacity probe compiled against the application's original modules.
//! The two inline modules only add visibility for diagnostics; cache logic is unchanged.
#![allow(dead_code, unused_imports)]

#[path = "../../../../native/mdict/src/block/mod.rs"]
mod block;
mod cache {
    include!("../../../../native/mdict/src/cache.rs");

    impl<K: Copy + Eq + Hash> BlockCache<K> {
        pub(crate) fn probe_snapshot(&self) -> (usize, usize, Vec<K>) {
            let state = self.state.lock().unwrap();
            (
                self.capacity,
                state.bytes,
                state.order.iter().copied().collect(),
            )
        }
    }
}
#[path = "../../../../native/mdict/src/comparison.rs"]
mod comparison;
#[path = "../../../../native/mdict/src/encoding.rs"]
mod encoding;
#[path = "../../../../native/mdict/src/error.rs"]
mod error;
#[path = "../../../../native/mdict/src/format/mod.rs"]
mod format;
mod mdict {
    include!("../../../../native/mdict/src/mdict.rs");

    impl Mdict {
        pub(crate) fn probe_snapshots(&self) -> [(usize, usize, Vec<u32>); 2] {
            [
                self.key_cache.probe_snapshot(),
                self.record_cache.probe_snapshot(),
            ]
        }
    }
}
#[path = "../../../../native/mdict/src/model.rs"]
mod model;
#[path = "../../../../native/mdict/src/options.rs"]
mod options;
#[path = "../../../../native/mdict/src/record.rs"]
mod record;
#[path = "../../../../native/mdict/src/scanner.rs"]
mod scanner;
#[path = "../../../../native/mdict/src/source.rs"]
mod source;

pub use error::{Error, LinkError, Result};
pub use mdict::Mdict;
pub use model::{Entry, FileKind, Key, Metadata, Version, Warning};
pub use options::{CacheOptions, Credentials, Limits, OpenOptions};

fn emit(name: &str, value: impl std::fmt::Display) {
    println!("{name}\t{value}");
}

fn memory(stage: &str) {
    #[cfg(windows)]
    {
        #[repr(C)]
        struct Counters {
            cb: u32,
            faults: u32,
            values: [usize; 9],
        }
        #[link(name = "psapi")]
        unsafe extern "system" {
            fn GetProcessMemoryInfo(process: isize, counters: *mut Counters, cb: u32) -> i32;
        }
        let mut counters = Counters {
            cb: std::mem::size_of::<Counters>() as u32,
            faults: 0,
            values: [0; 9],
        };
        if unsafe { GetProcessMemoryInfo(-1, &mut counters, counters.cb) } != 0 {
            emit(&format!("{stage}.working_set_bytes"), counters.values[1]);
            emit(&format!("{stage}.private_commit_bytes"), counters.values[8]);
        }
    }
}

fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args_os().skip(1);
    let path = args
        .next()
        .ok_or("usage: dictol-mdict-cache-probe <file.mdx>")?;
    if args.next().is_some() {
        return Err("expected exactly one MDX path".into());
    }
    memory("baseline");
    let dictionary = Mdict::open(&path)?;
    if dictionary.kind() != FileKind::Mdx {
        return Err("expected an MDX file".into());
    }
    memory("opened");
    let meta = dictionary.metadata();
    emit("dictionary.file_bytes", std::fs::metadata(&path)?.len());
    emit("dictionary.entries", meta.entry_count);
    emit("dictionary.key_blocks", meta.key_block_count);
    emit("dictionary.record_blocks", meta.record_block_count);
    let total_key_bytes: usize = dictionary.key_blocks().iter().map(|b| b.decoded_size).sum();
    emit("dictionary.decoded_key_bytes", total_key_bytes);
    emit("dictionary.decoded_record_bytes", dictionary.record_size());
    emit(
        "dictionary.key_block_min_bytes",
        dictionary
            .key_blocks()
            .iter()
            .map(|b| b.decoded_size)
            .min()
            .unwrap_or(0),
    );
    emit(
        "dictionary.key_block_max_bytes",
        dictionary
            .key_blocks()
            .iter()
            .map(|b| b.decoded_size)
            .max()
            .unwrap_or(0),
    );
    emit(
        "dictionary.record_block_min_bytes",
        dictionary
            .record_blocks()
            .iter()
            .map(|b| b.decoded_size())
            .min()
            .unwrap_or(0),
    );
    emit(
        "dictionary.record_block_max_bytes",
        dictionary
            .record_blocks()
            .iter()
            .map(|b| b.decoded_size())
            .max()
            .unwrap_or(0),
    );

    // Populate the real LRU through the same decode functions used by random reads.
    for i in 0..dictionary.key_blocks().len() {
        dictionary.decode_key_block(i, true)?;
    }
    memory("key_cache_loaded");
    let (key_capacity, key_bytes, key_ids) = dictionary.probe_snapshots()[0].clone();
    let key_entries: u64 = key_ids
        .iter()
        .map(|id| dictionary.key_blocks()[*id as usize].entry_count)
        .sum();
    emit("key_cache.capacity_bytes", key_capacity);
    emit("key_cache.retained_bytes", key_bytes);
    emit("key_cache.retained_blocks", key_ids.len());
    emit("key_cache.covered_entries", key_entries);
    assert!(key_bytes <= key_capacity);
    assert_eq!(
        key_bytes,
        key_ids
            .iter()
            .map(|id| dictionary.key_blocks()[*id as usize].decoded_size)
            .sum()
    );
    if total_key_bytes <= key_capacity {
        assert_eq!(key_bytes, total_key_bytes);
    }

    let mut first_eviction = false;
    for i in 0..dictionary.record_blocks().len() {
        dictionary.decode_record_block(i, true)?;
        if !first_eviction {
            let (_, bytes, ids) = dictionary.probe_snapshots()[1].clone();
            if ids.len() < i + 1 {
                emit("record_cache.first_eviction_after_blocks", i + 1);
                emit("record_cache.first_eviction_retained_bytes", bytes);
                first_eviction = true;
            }
        }
    }
    memory("both_caches_loaded");
    let (record_capacity, record_bytes, mut record_ids) = dictionary.probe_snapshots()[1].clone();
    record_ids.sort_unstable();
    emit("record_cache.capacity_bytes", record_capacity);
    emit("record_cache.retained_bytes", record_bytes);
    emit("record_cache.retained_blocks", record_ids.len());
    emit(
        "record_cache.evicted_or_skipped_blocks",
        dictionary.record_blocks().len() - record_ids.len(),
    );
    assert!(record_bytes <= record_capacity);
    assert_eq!(
        record_bytes,
        record_ids
            .iter()
            .map(|id| dictionary.record_blocks()[*id as usize].decoded_size())
            .sum()
    );
    // This report uses a contiguous suffix; fail rather than miscount a sparse cache.
    if record_ids.windows(2).any(|pair| pair[1] != pair[0] + 1) {
        return Err("retained record blocks are not contiguous".into());
    }
    let first = *record_ids.first().ok_or("no record blocks fit the cache")? as usize;
    let last = *record_ids.last().unwrap() as usize;
    let start = dictionary.record_blocks()[first].logical_start;
    let end = dictionary.record_blocks()[last].logical_end;
    emit("record_cache.first_block_zero_based", first);
    emit("record_cache.last_block_zero_based", last);
    emit("record_cache.logical_start", start);
    emit("record_cache.logical_end", end);
    let mut scanned = 0_u64;
    let mut covered = 0_u64;
    let mut partial = 0_u64;
    let mut links = 0_u64;
    let mut link_bytes = 0_u64;
    let mut non_link_bytes = 0_u64;
    let mut zero_length = 0_u64;
    let mut first_word = None;
    let mut last_word = None;
    for item in dictionary.keys() {
        let key = item?;
        scanned += 1;
        if key.record_start >= start && key.record_end <= end && key.record_end > key.record_start {
            covered += 1;
            let bytes = dictionary.read_record(key.record_start, key.record_end)?;
            if bytes
                .get(..8)
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case(b"@@@LINK="))
            {
                links += 1;
                link_bytes += bytes.len() as u64;
            } else {
                non_link_bytes += bytes.len() as u64;
            }
            if first_word.is_none() {
                first_word = Some(key.text.clone());
            }
            last_word = Some(key.text);
        } else if key.record_start < end && key.record_end > start {
            partial += 1;
        } else if key.record_start == key.record_end
            && key.record_start >= start
            && key.record_start < end
        {
            zero_length += 1;
        }
    }
    assert_eq!(scanned, meta.entry_count);
    let (_, final_bytes, mut final_ids) = dictionary.probe_snapshots()[1].clone();
    final_ids.sort_unstable();
    assert_eq!(final_bytes, record_bytes);
    assert_eq!(final_ids, record_ids);
    emit("record_cache.fully_covered_nonempty_entries", covered);
    emit("record_cache.link_entries", links);
    emit("record_cache.link_entry_bytes", link_bytes);
    emit("record_cache.non_link_entries", covered - links);
    emit("record_cache.non_link_entry_bytes", non_link_bytes);
    emit("record_cache.partially_covered_entries", partial);
    emit("record_cache.zero_length_entries", zero_length);
    emit("record_cache.first_word", first_word.unwrap_or_default());
    emit("record_cache.last_word", last_word.unwrap_or_default());
    drop(dictionary);
    memory("closed");

    // Count record kinds using the existing sequential cursor, which bypasses LRU.
    let dictionary = Mdict::open_with_options(
        &path,
        OpenOptions {
            cache: CacheOptions {
                key_blocks_bytes: 0,
                record_blocks_bytes: 0,
            },
            ..OpenOptions::default()
        },
    )?;
    let mut total_links = 0_u64;
    let mut total_entries = 0_u64;
    for item in dictionary.entries() {
        let entry = item?;
        total_entries += 1;
        if entry
            .data
            .get(..8)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(b"@@@LINK="))
        {
            total_links += 1;
        }
    }
    assert_eq!(total_entries, dictionary.metadata().entry_count);
    emit("dictionary.link_entries", total_links);
    emit("dictionary.non_link_entries", total_entries - total_links);
    Ok(())
}
