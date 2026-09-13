use crate::{Error, Result};
use unicode_casefold::UnicodeCaseFold;
use unicode_general_category::{GeneralCategory as G, get_general_category};
use unicode_normalization::UnicodeNormalization;

/// Ordered match tiers. Only the first two are exact lookup results.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum MatchKind {
    /// Canonically equivalent original spelling.
    Exact,
    /// Unicode case-equivalent spelling.
    CaseInsensitive,
    /// Accent, punctuation or spacing alternative.
    Loose,
    /// Headword starts with the query after normalization.
    Prefix,
    /// Spelling suggestion, not an automatic correction.
    Fuzzy,
    /// Explicit wildcard query.
    Wildcard,
}
impl MatchKind {
    /// Stable API label.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Exact => "exact",
            Self::CaseInsensitive => "case-insensitive",
            Self::Loose => "loose",
            Self::Prefix => "prefix",
            Self::Fuzzy => "fuzzy",
            Self::Wildcard => "wildcard",
        }
    }
}

pub(super) fn case_key(text: &str) -> String {
    text.trim().nfc().case_fold().nfc().collect()
}
pub(super) fn normalize(text: &str) -> String {
    let folded = case_key(text);
    let loose = loose_key(&folded);
    // Preserve punctuation-only headwords (e.g. "?") as searchable entries.
    if loose.is_empty() { folded } else { loose }
}
fn loose_key(folded: &str) -> String {
    folded
        .nfkd()
        .filter(|c| {
            !c.is_whitespace()
                && !matches!(
                    get_general_category(*c),
                    G::NonspacingMark
                        | G::SpacingMark
                        | G::EnclosingMark
                        | G::ConnectorPunctuation
                        | G::DashPunctuation
                        | G::OpenPunctuation
                        | G::ClosePunctuation
                        | G::InitialPunctuation
                        | G::FinalPunctuation
                        | G::OtherPunctuation
                )
        })
        .collect()
}
pub(super) fn rank(query: &str, word: &str) -> MatchKind {
    if query.trim().nfc().eq(word.trim().nfc()) {
        MatchKind::Exact
    } else if case_key(query) == case_key(word) {
        MatchKind::CaseInsensitive
    } else if normalize(query) == normalize(word) {
        MatchKind::Loose
    } else {
        MatchKind::Prefix
    }
}

#[derive(Debug, PartialEq)]
pub(super) enum Token {
    Literal(char),
    One,
    Many,
}
pub(super) fn parse_pattern(pattern: &str) -> Result<Vec<Token>> {
    let text = case_key(pattern);
    let mut chars = text.chars();
    let mut tokens = Vec::new();
    while let Some(c) = chars.next() {
        let token = match c {
            '\\' => Token::Literal(
                chars
                    .next()
                    .ok_or_else(|| Error::unsupported("DIDX dangling wildcard escape"))?,
            ),
            '?' => Token::One,
            '*' => Token::Many,
            _ => Token::Literal(c),
        };
        if token != Token::Many || tokens.last() != Some(&Token::Many) {
            tokens.push(token);
        }
    }
    Ok(tokens)
}
pub(super) fn wildcard_prefix(tokens: &[Token]) -> String {
    let prefix: String = tokens
        .iter()
        .take_while(|t| matches!(t, Token::Literal(_)))
        .filter_map(|t| {
            if let Token::Literal(c) = t {
                Some(*c)
            } else {
                None
            }
        })
        .collect();
    // A punctuation-only prefix may disappear when followed by letters. Scan
    // from the start in that case rather than incorrectly excluding candidates.
    loose_key(&prefix)
}
pub(super) fn wildcard_matches(tokens: &[Token], word: &str) -> bool {
    let word: Vec<char> = case_key(word).chars().collect();
    let mut row = vec![false; word.len() + 1];
    row[0] = true;
    for token in tokens {
        let mut next = vec![false; row.len()];
        next[0] = *token == Token::Many && row[0];
        for i in 1..row.len() {
            next[i] = match token {
                Token::Many => row[i] || next[i - 1],
                Token::One => row[i - 1],
                Token::Literal(c) => row[i - 1] && *c == word[i - 1],
            };
        }
        row = next;
    }
    row[word.len()]
}
