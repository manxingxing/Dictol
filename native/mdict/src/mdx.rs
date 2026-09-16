use std::collections::HashSet;
use std::path::Path;

use crate::encoding::decode_lossy;
use crate::format::decode_entities_lenient;
use crate::model::{Entry, FileKind, Key};
use crate::options::OpenOptions;
use crate::scanner::{Entries, Keys, Prefix};
use crate::{Error, LinkError, Mdict, Result};

const MAX_LINK_REDIRECTS: usize = 16;

/// Text-oriented MDX entry point.
#[derive(Debug)]
pub struct Mdx {
    inner: Mdict,
    style_sheet: Vec<(String, String)>,
}

impl Mdx {
    /// 使用默认配置打开并验证一份 MDX 文本词典。
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        Self::open_with_options(path, OpenOptions::default())
    }

    /// 使用调用方配置打开 MDX，并预解析 Header StyleSheet。
    pub fn open_with_options(path: impl AsRef<Path>, options: OpenOptions) -> Result<Self> {
        let inner = Mdict::open_with_options(path, options)?;
        Self::from_mdict(inner)
    }

    /// 将已经打开的 MDX 基础读取器提升为文本入口，避免重复映射同一文件。
    pub fn from_mdict(inner: Mdict) -> Result<Self> {
        if inner.kind() != FileKind::Mdx {
            return Err(Error::invalid(
                inner.path(),
                4,
                "expected an MDX text dictionary",
            ));
        }
        let style_sheet = parse_style_sheet(inner.header.style_sheet.as_str(), inner.path())?;
        Ok(Self { inner, style_sheet })
    }

    /// 返回负责基础二进制读取的 `Mdict`。
    pub fn as_mdict(&self) -> &Mdict {
        &self.inner
    }

    /// 按原始顺序遍历 MDX key。
    pub fn keys(&self) -> Keys<'_> {
        self.inner.keys()
    }

    /// 按原始顺序遍历 key 与未经文本处理的 record。
    pub fn entries(&self) -> Entries<'_> {
        self.inner.entries()
    }

    /// 返回第一个精确匹配 key 的逻辑位置。
    pub fn find_key(&self, key: &str) -> Result<Option<Key>> {
        self.inner.find_key(key)
    }

    /// 返回所有规范化后精确匹配的重复 key。
    pub fn find_keys(&self, key: &str) -> Result<Vec<Key>> {
        self.inner.find_keys(key)
    }

    /// 创建流式前缀查询迭代器。
    pub fn prefix(&self, prefix: &str) -> Result<Prefix<'_>> {
        self.inner.prefix(prefix)
    }

    /// 查找 key 并返回未经解码的原始 record bytes。
    pub fn lookup(&self, key: &str) -> Result<Option<Entry>> {
        self.inner.lookup(key)
    }

    /// 查找 key 并按文件原始顺序返回全部未经解码的 record bytes。
    pub fn lookup_all(&self, key: &str) -> Result<Vec<Entry>> {
        self.inner.lookup_all(key)
    }

    /// 读取、解码并展开 StyleSheet；可选择是否解析 `@@@LINK=`。
    pub fn read_record_text(
        &self,
        record_start: u64,
        record_end: u64,
        redirect_link: bool,
    ) -> Result<String> {
        let bytes = self.inner.read_record(record_start, record_end)?;
        let text = decode_lossy(&bytes, &self.inner.metadata().encoding);
        let text = if redirect_link {
            self.resolve_text(text)?
        } else {
            text
        };
        Ok(self.expand_style_sheet(&text))
    }

    /// 查找 key，解析 LINK 并返回 StyleSheet 展开后的 UTF-8 文本。
    pub fn lookup_text(&self, key: &str) -> Result<Option<String>> {
        let Some(found) = self.inner.find_key(key)? else {
            return Ok(None);
        };
        self.read_record_text(found.record_start, found.record_end, true)
            .map(Some)
    }

    /// 查找全部精确匹配 key，逐条解析 LINK 并返回 StyleSheet 展开后的 UTF-8 文本。
    pub fn lookup_all_text(&self, key: &str) -> Result<Vec<String>> {
        self.inner
            .find_keys(key)?
            .into_iter()
            .map(|found| self.read_record_text(found.record_start, found.record_end, true))
            .collect()
    }

    /// 严格跟随 LINK 链，返回最终尚未展开 StyleSheet 的文本。
    fn resolve_text(&self, mut text: String) -> Result<String> {
        let mut visited = HashSet::new();
        for depth in 0..=MAX_LINK_REDIRECTS {
            let Some(target) = parse_link_target(&text) else {
                return Ok(text);
            };
            if depth == MAX_LINK_REDIRECTS {
                return Err(LinkError::TooDeep {
                    maximum: MAX_LINK_REDIRECTS,
                }
                .into());
            }
            if !visited.insert(target.to_owned()) {
                return Err(LinkError::Cycle {
                    target: target.to_owned(),
                }
                .into());
            }
            let found = self
                .inner
                .find_key(target)?
                .ok_or_else(|| LinkError::Missing {
                    target: target.to_owned(),
                })?;
            let bytes = self
                .inner
                .read_record(found.record_start, found.record_end)?;
            text = decode_lossy(&bytes, &self.inner.metadata().encoding);
        }
        unreachable!()
    }

    /// 在存在 StyleSheet 时展开 compact record，否则原样复制文本。
    fn expand_style_sheet(&self, source: &str) -> String {
        if self.style_sheet.is_empty() {
            source.to_owned()
        } else {
            expand_compact(source, &self.style_sheet)
        }
    }
}

/// 仅在整条 record 是合法 `@@@LINK=` 指令时返回目标 key。
fn parse_link_target(record: &str) -> Option<&str> {
    let command = record.trim_end_matches('\0');
    let command = command
        .strip_suffix("\r\n")
        .or_else(|| command.strip_suffix('\n'))
        .unwrap_or(command);
    let prefix = command.get(.."@@@LINK=".len())?;
    if !prefix.eq_ignore_ascii_case("@@@LINK=") {
        return None;
    }
    let target = command.get("@@@LINK=".len()..)?.trim();
    if target.is_empty() || target.contains(['\r', '\n', '\0']) {
        None
    } else {
        Some(target)
    }
}

/// 将 Header StyleSheet 的三行记录解析为 256 个 token 槽位。
fn parse_style_sheet(source: &str, path: &Path) -> Result<Vec<(String, String)>> {
    if source.is_empty() {
        return Ok(Vec::new());
    }
    let mut styles = vec![(String::new(), String::new()); 256];
    let mut lines = source.split('\n');
    let mut any = false;
    while let Some(token_line) = lines.next() {
        let token_line = token_line.trim_end_matches('\r');
        if token_line.is_empty() && lines.clone().next().is_none() {
            break;
        }
        let token = token_line.trim().parse::<usize>().map_err(|error| {
            Error::invalid(
                path,
                4,
                format!("invalid StyleSheet token {token_line:?}: {error}"),
            )
        })?;
        if token > 255 {
            return Err(Error::invalid(path, 4, "StyleSheet token exceeds 255"));
        }
        let prefix = lines
            .next()
            .ok_or_else(|| Error::invalid(path, 4, "StyleSheet token is missing a prefix"))?
            .trim_end_matches('\r');
        let suffix = lines
            .next()
            .ok_or_else(|| Error::invalid(path, 4, "StyleSheet token is missing a suffix"))?
            .trim_end_matches('\r');
        let (prefix, _) = decode_entities_lenient(prefix);
        let (suffix, _) = decode_entities_lenient(suffix);
        styles[token] = (prefix, suffix);
        any = true;
    }
    if any { Ok(styles) } else { Ok(Vec::new()) }
}

/// 扫描反引号 token 并展开对应的 prefix、内容和 suffix。
fn expand_compact(source: &str, styles: &[(String, String)]) -> String {
    let mut output = String::with_capacity(source.len());
    let mut position = 0;
    while let Some(relative_start) = source[position..].find('`') {
        let start = position + relative_start;
        output.push_str(&source[position..start]);
        let number_start = start + 1;
        let Some(relative_close) = source[number_start..].find('`') else {
            output.push_str(&source[start..]);
            return output;
        };
        let close = number_start + relative_close;
        let token_text = &source[number_start..close];
        let Ok(token) = token_text.parse::<usize>() else {
            output.push('`');
            position = number_start;
            continue;
        };
        if token >= styles.len() {
            output.push_str(&source[start..=close]);
            position = close + 1;
            continue;
        }
        let content_start = close + 1;
        let content_end = source[content_start..]
            .find('`')
            .map(|relative| content_start + relative)
            .unwrap_or(source.len());
        output.push_str(&styles[token].0);
        output.push_str(&source[content_start..content_end]);
        output.push_str(&styles[token].1);
        position = content_end;
    }
    output.push_str(&source[position..]);
    output
}

#[cfg(test)]
mod tests {
    use super::{expand_compact, parse_link_target};

    #[test]
    /// 验证 LINK 必须独占整条 record。
    fn parses_only_whole_link_records() {
        assert_eq!(parse_link_target("@@@LINK=target\n"), Some("target"));
        assert_eq!(parse_link_target("before @@@LINK=target"), None);
    }

    #[test]
    /// 验证 compact token 会包裹后续片段。
    fn expands_compact_tokens() {
        let mut styles = vec![(String::new(), String::new()); 256];
        styles[1] = ("<b>".into(), "</b>".into());
        assert_eq!(expand_compact("x`1`word`y", &styles), "x<b>word</b>`y");
    }
}
