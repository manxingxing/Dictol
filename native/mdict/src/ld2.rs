//! Lingoes LD2 reader. Offsets are little-endian; definitions remain in the source.
use std::{io::Read, path::Path, sync::Arc};

use crate::cache::BlockCache;
use crate::source::{MappedSource, sampled_bytes_fingerprint};
use crate::{DidxBuildResult, DidxIndex, Error, IndexEntry, IndexSource, Result};

/// Text codec for LD2 words or definition XML.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ld2Encoding {
    /// UTF-8.
    Utf8,
    /// UTF-16, little endian.
    Utf16Le,
    /// UTF-16, big endian.
    Utf16Be,
}

impl Ld2Encoding {
    fn decode(self, bytes: &[u8]) -> Result<String> {
        let invalid = || Error::unsupported("invalid LD2 text encoding");
        match self {
            Self::Utf8 => String::from_utf8(bytes.to_vec()).map_err(|_| invalid()),
            Self::Utf16Le | Self::Utf16Be => {
                if bytes.len() % 2 != 0 {
                    return Err(invalid());
                }
                let units: Vec<_> = bytes
                    .chunks_exact(2)
                    .map(|b| {
                        if self == Self::Utf16Le {
                            u16::from_le_bytes([b[0], b[1]])
                        } else {
                            u16::from_be_bytes([b[0], b[1]])
                        }
                    })
                    .collect();
                String::from_utf16(&units).map_err(|_| invalid())
            }
        }
    }
}

/// Read-only LD2 mapping with a bounded cache of independently compressed blocks.
pub struct Ld2 {
    source: MappedSource,
    compressed_start: usize,
    offsets: Vec<usize>,
    block_size: usize,
    total_size: usize,
    words_start: usize,
    xml_start: usize,
    count: u32,
    words_encoding: Ld2Encoding,
    xml_encoding: Ld2Encoding,
    cache: BlockCache<usize>,
}

impl Ld2 {
    /// Open the block directory and detect Unicode codecs without inflating all definitions.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let source = MappedSource::open(path.as_ref())?;
        let b = source.bytes();
        let invalid = || Error::invalid(source.path(), 0, "invalid LD2 header or block directory");
        if b.get(..4) != Some(b"?LD2") {
            return Err(invalid());
        }
        let mut header = number(b, 0x5c)? + 0x60;
        if number(b, header)? != 3 {
            header += number(b, header + 4)? + 12;
        }
        if number(b, header)? != 3 {
            return Err(invalid());
        }
        let limit = header + 8 + number(b, header + 4)?;
        let compressed_header = header + 28 + number(b, header + 8)?;
        let words_start = number(b, header + 12)?;
        let xml_start = words_start + number(b, header + 16)?;
        let total_size = xml_start + number(b, header + 20)?;
        let block_size = number(b, compressed_header + 4)?;
        if limit > b.len()
            || words_start < 10
            || words_start % 10 != 0
            || total_size != number(b, compressed_header)?
            || block_size == 0
            || block_size > 16 * 1024 * 1024
        {
            return Err(invalid());
        }
        let blocks = total_size.div_ceil(block_size);
        let table = compressed_header + 8;
        let compressed_start = table.checked_add((blocks + 1) * 4).ok_or_else(invalid)?;
        if compressed_start > limit {
            return Err(invalid());
        }
        let offsets: Vec<_> = (0..=blocks)
            .map(|i| number(b, table + i * 4))
            .collect::<Result<_>>()?;
        if offsets[0] != 0
            || offsets.windows(2).any(|w| w[0] >= w[1])
            || offsets[blocks] != limit - compressed_start
        {
            return Err(invalid());
        }
        let mut result = Self {
            source,
            compressed_start,
            offsets,
            block_size,
            total_size,
            words_start,
            xml_start,
            count: (words_start / 10 - 1) as u32,
            words_encoding: Ld2Encoding::Utf8,
            xml_encoding: Ld2Encoding::Utf8,
            cache: BlockCache::new(2 * 1024 * 1024),
        };
        let mut words = Vec::new();
        for id in 0..result.count.min(128) {
            let (word, xml, _) = result.record(id)?;
            words.extend_from_slice(&word);
            if !xml.is_empty() {
                result.xml_encoding = if xml.starts_with(b"<\0") {
                    Ld2Encoding::Utf16Le
                } else if xml.starts_with(b"\0<") {
                    Ld2Encoding::Utf16Be
                } else {
                    Ld2Encoding::Utf8
                };
            }
        }
        result.words_encoding = if words.contains(&0) || std::str::from_utf8(&words).is_err() {
            if result.xml_encoding == Ld2Encoding::Utf16Be {
                Ld2Encoding::Utf16Be
            } else {
                Ld2Encoding::Utf16Le
            }
        } else {
            Ld2Encoding::Utf8
        };
        Ok(result)
    }

    /// Override codec detection for a dictionary with ambiguous word bytes.
    pub fn with_encodings(mut self, words: Ld2Encoding, xml: Ld2Encoding) -> Self {
        self.words_encoding = words;
        self.xml_encoding = xml;
        self
    }

    /// Number of physical headwords, excluding the sentinel record.
    pub fn entry_count(&self) -> u32 {
        self.count
    }

    /// Detected word and definition codecs.
    pub fn encodings(&self) -> (Ld2Encoding, Ld2Encoding) {
        (self.words_encoding, self.xml_encoding)
    }

    /// Read the original spelling of one headword.
    pub fn key(&self, id: u32) -> Result<String> {
        let [word_start, word_end, _, _, refs_size] = self.record_header(id)?;
        let word = self.range(
            self.words_start + word_start + refs_size,
            word_end - word_start - refs_size,
        )?;
        self.words_encoding.decode(&word)
    }

    /// Return this entry's XML and the XML fragments referenced by it.
    /// References address physical definitions, not recursive dictionary links.
    pub fn definition_xml(&self, id: u32) -> Result<Vec<String>> {
        let (_, xml, refs) = self.record(id)?;
        let mut definitions = Vec::new();
        for bytes in refs.chunks_exact(4) {
            let referenced = u32::from_le_bytes(bytes.try_into().unwrap());
            let (_, xml, _) = self.record(referenced)?;
            if !xml.is_empty() {
                definitions.push(self.xml_encoding.decode(&xml)?);
            }
        }
        if !xml.is_empty() {
            definitions.push(self.xml_encoding.decode(&xml)?);
        }
        Ok(definitions)
    }

    /// Decode a four-byte LD2 row locator and read its definition fragments.
    pub fn read_index_record(&self, locator: &[u8]) -> Result<Vec<String>> {
        let bytes = locator
            .try_into()
            .map_err(|_| Error::unsupported("invalid LD2 locator"))?;
        self.definition_xml(u32::from_le_bytes(bytes))
    }

    /// Build the shared DIDX format directly from LD2 headwords.
    pub fn build_index(&self, output: impl AsRef<Path>) -> Result<DidxBuildResult> {
        if output
            .as_ref()
            .canonicalize()
            .ok()
            .zip(self.source.path().canonicalize().ok())
            .is_some_and(|(a, b)| a == b)
        {
            return Err(Error::unsupported("DIDX must not overwrite LD2 source"));
        }
        DidxIndex::build(&Ld2IndexSource(self), output)
    }

    fn record(&self, id: u32) -> Result<(Vec<u8>, Vec<u8>, Vec<u8>)> {
        let [word_start, word_end, xml_start, xml_end, refs_size] = self.record_header(id)?;
        Ok((
            self.range(
                self.words_start + word_start + refs_size,
                word_end - word_start - refs_size,
            )?,
            self.range(self.xml_start + xml_start, xml_end - xml_start)?,
            self.range(self.words_start + word_start, refs_size)?,
        ))
    }

    fn record_header(&self, id: u32) -> Result<[usize; 5]> {
        if id >= self.count {
            return Err(Error::unsupported("LD2 row out of bounds"));
        }
        let row = self.range(id as usize * 10, 18)?;
        let word_start = number(&row, 0)?;
        let xml_start = number(&row, 4)?;
        let word_end = number(&row, 10)?;
        let xml_end = number(&row, 14)?;
        let refs_size = row[9] as usize * 4;
        if word_start + refs_size > word_end
            || word_end > self.xml_start - self.words_start
            || xml_start > xml_end
            || xml_end > self.total_size - self.xml_start
        {
            return Err(Error::unsupported("LD2 record range out of bounds"));
        }
        Ok([word_start, word_end, xml_start, xml_end, refs_size])
    }

    fn range(&self, start: usize, length: usize) -> Result<Vec<u8>> {
        let end = start
            .checked_add(length)
            .filter(|end| *end <= self.total_size)
            .ok_or_else(|| Error::unsupported("LD2 logical range out of bounds"))?;
        let mut output = Vec::with_capacity(length);
        let mut position = start;
        while position < end {
            let index = position / self.block_size;
            let block = self.cache.get_or_try_insert(index, || {
                let start = self.compressed_start + self.offsets[index];
                let end = self.compressed_start + self.offsets[index + 1];
                let expected = self
                    .block_size
                    .min(self.total_size - index * self.block_size);
                let mut decoder = flate2::read::ZlibDecoder::new(&self.source.bytes()[start..end]);
                let mut decoded = Vec::with_capacity(expected);
                (&mut decoder)
                    .take(expected as u64 + 1)
                    .read_to_end(&mut decoded)
                    .map_err(|e| Error::io(self.source.path(), e))?;
                if decoded.len() != expected || decoder.total_in() as usize != end - start {
                    return Err(Error::invalid(
                        self.source.path(),
                        start as u64,
                        "LD2 block size mismatch",
                    ));
                }
                Ok(Arc::from(decoded))
            })?;
            let offset = position % self.block_size;
            let size = (end - position).min(block.len() - offset);
            output.extend_from_slice(&block[offset..offset + size]);
            position += size;
        }
        Ok(output)
    }
}

/// DIDX adapter with four-byte little-endian physical row locators.
pub struct Ld2IndexSource<'a>(pub &'a Ld2);

impl IndexSource for Ld2IndexSource<'_> {
    fn fingerprint(&self) -> Result<u64> {
        let seed = 0x4c443201
            + ((self.0.words_encoding as u64) << 32)
            + ((self.0.xml_encoding as u64) << 40);
        Ok(sampled_bytes_fingerprint(self.0.source.bytes(), seed))
    }

    fn entries(&self) -> Result<Box<dyn Iterator<Item = Result<IndexEntry>> + '_>> {
        Ok(Box::new((0..self.0.count).map(|id| {
            Ok(IndexEntry {
                key_text: self.0.key(id)?,
                locator: id.to_le_bytes().to_vec(),
            })
        })))
    }
}

fn number(bytes: &[u8], offset: usize) -> Result<usize> {
    let data = bytes
        .get(offset..offset.saturating_add(4))
        .ok_or_else(|| Error::unsupported("truncated LD2 integer"))?;
    Ok(u32::from_le_bytes(data.try_into().unwrap()) as usize)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn fixture() -> Vec<u8> {
        let xml = b"<C><F><K><![CDATA[mouse definition]]></K></F></C>";
        let mut data = Vec::new();
        // 'mice' has no body and references the following 'mouse' record.
        for (word, body, refs) in [(0u32, 0u32, 1u8), (8, 0, 0), (13, xml.len() as u32, 0)] {
            data.extend(word.to_le_bytes());
            data.extend(body.to_le_bytes());
            data.extend([0, refs]);
        }
        data.extend(1u32.to_le_bytes());
        data.extend(b"micemouse");
        data.extend(xml);
        let mut compressed = Vec::new();
        let mut offsets = vec![0u32];
        // Small blocks deliberately split row headers, words and XML.
        for chunk in data.chunks(16) {
            let mut encoder =
                flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
            encoder.write_all(chunk).unwrap();
            compressed.extend(encoder.finish().unwrap());
            offsets.push(compressed.len() as u32);
        }
        let mut file = vec![0u8; 0x60];
        file[..4].copy_from_slice(b"?LD2");
        let section_size = 28 + 8 + offsets.len() * 4 + compressed.len();
        for value in [
            3,
            (section_size - 8) as u32,
            0,
            30,
            13,
            xml.len() as u32,
            0,
            data.len() as u32,
            16,
        ] {
            file.extend(value.to_le_bytes());
        }
        for offset in offsets {
            file.extend(offset.to_le_bytes());
        }
        file.extend(compressed);
        file
    }

    #[test]
    fn cross_block_references_and_didx_round_trip() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("fixture.ld2");
        std::fs::write(&path, fixture()).unwrap();
        let dictionary = Ld2::open(&path).unwrap();
        assert_eq!(dictionary.entry_count(), 2);
        assert_eq!(dictionary.key(0).unwrap(), "mice");
        assert_eq!(dictionary.key(1).unwrap(), "mouse");
        assert_eq!(
            dictionary.definition_xml(0).unwrap(),
            dictionary.definition_xml(1).unwrap()
        );
        assert!(dictionary.definition_xml(2).is_err());
        assert!(dictionary.read_index_record(&[0]).is_err());
        assert!(dictionary.build_index(&path).is_err());
        let index_path = root.path().join("index.didx");
        dictionary.build_index(&index_path).unwrap();
        let index = DidxIndex::open_for_source(
            &index_path,
            Ld2IndexSource(&dictionary).fingerprint().unwrap(),
        )
        .unwrap();
        let hit = &index.exact("mice", None).unwrap()[0];
        assert_eq!(
            dictionary.read_index_record(&hit.locator).unwrap(),
            dictionary.definition_xml(1).unwrap()
        );
        assert!(!index.prefix("mi", Some(10)).unwrap().is_empty());
    }

    #[test]
    fn truncated_and_corrupt_sources_return_errors() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("bad.ld2");
        let original = fixture();
        for length in [1, 32, 95, 110, original.len() - 1] {
            std::fs::write(&path, &original[..length]).unwrap();
            assert!(Ld2::open(&path).is_err());
        }
        let mut damaged = original;
        let last = damaged.len() - 1;
        damaged[last] ^= 0xff;
        std::fs::write(&path, damaged).unwrap();
        assert!(Ld2::open(&path).is_err());
    }
}
