//! A memory-mapped reader for MDict v1, v2 and v3 dictionaries.
//!
//! [`Mdict`] exposes the common binary key/record model. [`Mdx`] adds text,
//! link and StyleSheet semantics. [`Mdd`] represents one physical resource
//! dictionary, while [`MddList`] searches an explicitly ordered file list.

#![doc = include_str!("../README.md")]
#![warn(missing_docs)]

mod block;
mod cache;
mod comparison;
mod encoding;
mod error;
mod format;
mod index;
mod ld2;
mod mdd;
mod mdict;
mod mdx;
mod mdx_index;
mod model;
mod options;
mod record;
mod scanner;
mod source;

pub use error::{Error, LinkError, Result};
pub use ld2::{Ld2, Ld2Encoding, Ld2IndexSource};
pub use index::{
    BuildResult as DidxBuildResult, DidxIndex, IndexEntry, IndexMatch, IndexSource, MatchKind,
};
pub use mdd::{
    Mdd, MddList, MddListEntries, MddListEntryScanner, MddListKeyScanner, MddListKeys,
    MddListPrefix,
};
pub use mdict::Mdict;
pub use mdx::Mdx;
pub use mdx_index::{MdxIndexSource, decode_mdx_locator};
pub use model::{EncryptionSummary, Entry, FileKind, Key, MddKey, Metadata, Version, Warning};
pub use options::{CacheOptions, Credentials, Limits, OpenOptions};
pub use scanner::{Entries, KeyScanner, Keys, Prefix};
