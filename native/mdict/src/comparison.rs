use std::cmp::Ordering;
use std::sync::Arc;

use icu_collator::options::{AlternateHandling, CaseLevel, CollatorOptions, Strength};
use icu_collator::{Collator, CollatorBorrowed, CollatorPreferences};
use icu_locale::Locale;

use crate::format::Header;
use crate::model::{Version, Warning};
use crate::{Error, Result};

#[derive(Clone)]
pub(crate) enum KeyComparison {
    V2 {
        case_sensitive: bool,
        strip_key: bool,
    },
    V3 {
        collator: Arc<CollatorBorrowed<'static>>,
    },
}

impl std::fmt::Debug for KeyComparison {
    /// 输出比较器种类，不展开 ICU 内部状态。
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::V2 {
                case_sensitive,
                strip_key,
            } => formatter
                .debug_struct("V2Comparison")
                .field("case_sensitive", case_sensitive)
                .field("strip_key", strip_key)
                .finish(),
            Self::V3 { .. } => formatter.write_str("V3Comparison(ICU4X)"),
        }
    }
}

impl KeyComparison {
    /// 返回写入 DIDX header 的 key 规范化标志。
    pub(crate) fn index_flags(&self) -> u32 {
        match self {
            Self::V2 {
                case_sensitive,
                strip_key,
            } => u32::from(*case_sensitive) | (u32::from(*strip_key) << 1),
            // v3 的 ICU 比较器不能只用两个 bit 完整序列化；第一版 DIDX
            // 保留原始 UTF-8 key，后续可增加 ICU sort-key section。
            Self::V3 { .. } => INDEX_FLAG_PRESERVE,
        }
    }

    /// 根据 Header 构造 v2 规范化规则或 v3 ICU4X collator；v1 复用此路径。
    pub(crate) fn from_header(header: &Header, warnings: &mut Vec<Warning>) -> Result<Self> {
        if header.version != Version::V3 {
            return Ok(Self::V2 {
                case_sensitive: header.key_case_sensitive,
                strip_key: header.strip_key,
            });
        }

        let (preferences, options) = collator_configuration(&header.sorting_locale, warnings)?;
        let collator = Collator::try_new(preferences, options).map_err(|error| {
            Error::unsupported(format!(
                "ICU4X collation locale {:?}: {error:?}",
                header.sorting_locale
            ))
        })?;
        Ok(Self::V3 {
            collator: Arc::new(collator),
        })
    }

    /// 按当前词典的排序语义比较两个完整 key。
    pub(crate) fn compare(&self, left: &str, right: &str) -> Ordering {
        match self {
            Self::V2 { .. } => self.normalize(left).cmp(&self.normalize(right)),
            Self::V3 { collator } => collator.compare(left, right),
        }
    }

    /// 判断 comparison-equal 候选是否保留了查询中的标点、空格和大小写语义。
    ///
    /// v1/v2 仅应用 Header 的大小写规则，不应用 StripKey；v3 在 ICU 等价
    /// 候选中优先选择原始文本完全相同的 key。
    pub(crate) fn is_preferred_match(&self, candidate: &str, query: &str) -> bool {
        match self {
            Self::V2 { case_sensitive, .. } => {
                if *case_sensitive {
                    candidate == query
                } else {
                    candidate.to_lowercase() == query.to_lowercase()
                }
            }
            Self::V3 { .. } => candidate == query,
        }
    }

    /// 用 descriptor 中已经准备好的边界值与查询词比较。
    pub(crate) fn compare_boundary(&self, prepared: &str, query: &str) -> Ordering {
        match self {
            Self::V2 { .. } => prepared.cmp(&self.normalize(query)),
            Self::V3 { collator } => collator.compare(prepared, query),
        }
    }

    /// 用 descriptor 中已经准备好的边界值执行前缀比较。
    pub(crate) fn prefix_compare_boundary(&self, prepared: &str, prefix: &str) -> Ordering {
        match self {
            Self::V2 { .. } => {
                let prefix = self.normalize(prefix);
                let candidate_prefix: String =
                    prepared.chars().take(prefix.chars().count()).collect();
                candidate_prefix.cmp(&prefix)
            }
            Self::V3 { collator } => {
                let candidate_prefix: String =
                    prepared.chars().take(prefix.chars().count()).collect();
                collator.compare(&candidate_prefix, prefix)
            }
        }
    }

    /// 按当前词典的排序语义判断候选 key 的相同长度前缀。
    pub(crate) fn prefix_compare(&self, candidate: &str, prefix: &str) -> Ordering {
        match self {
            Self::V2 { .. } => {
                let candidate = self.normalize(candidate);
                let prefix = self.normalize(prefix);
                let candidate_prefix: String =
                    candidate.chars().take(prefix.chars().count()).collect();
                candidate_prefix.cmp(&prefix)
            }
            Self::V3 { collator } => {
                let candidate_prefix: String =
                    candidate.chars().take(prefix.chars().count()).collect();
                collator.compare(&candidate_prefix, prefix)
            }
        }
    }

    /// 生成 v2 字典用于索引边界比较的规范化 key；v1 同样使用该规则。
    pub(crate) fn normalize(&self, key: &str) -> String {
        match self {
            Self::V2 { .. } => normalize_index_key(key, self.index_flags()),
            Self::V3 { .. } => key.to_owned(),
        }
    }
}

/// 判断字符是否属于 MDict `StripKey` 约定的移除集合。
pub(crate) fn is_stripped(character: char) -> bool {
    matches!(
        character,
        '(' | ')' | '.' | ',' | '-' | '&' | '、' | ' ' | '\'' | '/' | '\\' | '@' | '_' | '$' | '!'
    )
}

/// DIDX 中表示 v3 原始 key 语义的规范化标志。
pub(crate) const INDEX_FLAG_PRESERVE: u32 = 1 << 2;

/// One normalization owner for MDX comparison, DIDX building and queries.
pub(crate) fn normalize_index_key(key: &str, flags: u32) -> String {
    if flags & INDEX_FLAG_PRESERVE != 0 {
        return key.to_owned();
    }
    let stripped = if flags & 2 != 0 {
        key.chars().filter(|c| !is_stripped(*c)).collect::<String>()
    } else {
        key.to_owned()
    };
    if flags & 1 == 0 {
        stripped.to_lowercase()
    } else {
        stripped
    }
}

/// 将 BCP-47 locale 与 Unicode 扩展转换为 ICU4X 配置。
fn collator_configuration(
    locale_string: &str,
    warnings: &mut Vec<Warning>,
) -> Result<(CollatorPreferences, CollatorOptions)> {
    if locale_string.is_empty() {
        return Ok((CollatorPreferences::default(), CollatorOptions::default()));
    }
    let locale: Locale = locale_string.parse().map_err(|error| {
        Error::unsupported(format!(
            "invalid BCP-47 locale {locale_string:?}: {error:?}"
        ))
    })?;
    let preferences = CollatorPreferences::from(&locale);
    let mut options = CollatorOptions::default();
    for (key, value) in locale.extensions.unicode.keywords.iter() {
        let key = key.as_str();
        let value = value.to_string();
        match key {
            "ks" => {
                options.strength = Some(match value.as_str() {
                    "level1" => Strength::Primary,
                    "level2" => Strength::Secondary,
                    "level3" => Strength::Tertiary,
                    "level4" => Strength::Quaternary,
                    "identic" => Strength::Identical,
                    _ => Strength::Primary,
                });
            }
            "ka" => {
                options.alternate_handling = Some(match value.as_str() {
                    "shifted" => AlternateHandling::Shifted,
                    _ => AlternateHandling::NonIgnorable,
                });
            }
            "kc" => {
                options.case_level = Some(match value.as_str() {
                    "false" | "no" | "off" => CaseLevel::Off,
                    _ => CaseLevel::On,
                });
            }
            "kr" | "kv" => warnings.push(Warning {
                message: format!(
                    "ICU4X does not support Unicode collation option {key}={value}; ignored"
                ),
            }),
            "co" | "kf" | "kn" | "kb" => {}
            _ => {}
        }
    }
    Ok((preferences, options))
}

#[cfg(test)]
mod tests {
    use super::KeyComparison;

    #[test]
    /// 验证 v2 规范化会同时处理大小写和标点。
    fn v2_normalization_follows_mdict_rules() {
        let comparison = KeyComparison::V2 {
            case_sensitive: false,
            strip_key: true,
        };
        assert_eq!(comparison.normalize("Hello, World!"), "helloworld");
    }
}
