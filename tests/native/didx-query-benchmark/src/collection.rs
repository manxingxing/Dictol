use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use mdict::{DidxIndex, IndexMatch};
use napi::bindgen_prelude::{AsyncTask, Buffer};
use napi::{Env, Error, Result, Task};
use napi_derive::napi;
use rayon::prelude::*;

type Dictionary = (u32, Arc<DidxIndex>);

/// Experimental owner; it is deliberately not connected to the application's manager.
#[napi]
pub struct NativeDidxCollection {
    dictionaries: Vec<Dictionary>,
    concurrency: usize,
    pool: Arc<rayon::ThreadPool>,
}

#[napi]
impl NativeDidxCollection {
    #[napi(constructor)]
    pub fn new(concurrency: u32, threads: u32) -> Result<Self> {
        if concurrency == 0 || threads == 0 {
            return Err(Error::from_reason(
                "concurrency and threads must be positive",
            ));
        }
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(threads as usize)
            .build()
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(Self {
            dictionaries: Vec::new(),
            concurrency: concurrency as usize,
            pool: Arc::new(pool),
        })
    }

    /// Replacement retains dictionary order. Failed opens leave the collection intact.
    #[napi]
    pub fn set(&mut self, dictionary_id: u32, path: String) -> Result<()> {
        if dictionary_id == 0 {
            return Err(Error::from_reason("dictionaryId must be positive"));
        }
        let index = Arc::new(DidxIndex::open(path).map_err(to_napi_error)?);
        if let Some(item) = self.dictionaries.iter_mut().find(|d| d.0 == dictionary_id) {
            item.1 = index;
        } else {
            self.dictionaries.push((dictionary_id, index));
        }
        Ok(())
    }

    #[napi]
    pub fn remove(&mut self, dictionary_id: u32) -> bool {
        let previous = self.dictionaries.len();
        self.dictionaries.retain(|d| d.0 != dictionary_id);
        self.dictionaries.len() != previous
    }

    #[napi]
    pub fn clear(&mut self) {
        self.dictionaries.clear();
    }

    #[napi(ts_return_type = "Promise<Array<DictionaryMatch>>")]
    pub fn query(
        &self,
        query: String,
        stage: String,
        limit: u32,
    ) -> Result<AsyncTask<CollectionTask>> {
        let stage = match stage.as_str() {
            "normal" => Stage::Normal,
            "wildcard" => Stage::Wildcard,
            "fuzzy" => Stage::Fuzzy,
            _ => return Err(Error::from_reason("unknown query stage")),
        };
        if limit > 10_000 {
            return Err(Error::from_reason("limit must be at most 10000"));
        }
        Ok(AsyncTask::new(CollectionTask {
            dictionaries: self.dictionaries.clone(),
            concurrency: self.concurrency,
            pool: self.pool.clone(),
            query,
            stage,
            limit: limit as usize,
        }))
    }
}

#[derive(Clone, Copy)]
enum Stage {
    Normal,
    Wildcard,
    Fuzzy,
}

#[napi(object, object_from_js = false)]
pub struct DictionaryMatch {
    pub dictionary_id: u32,
    pub key_text: String,
    pub normalized_key: String,
    pub locator: Buffer,
    pub key_ordinal: u64,
    pub match_kind: String,
    pub distance: Option<u32>,
}

pub struct CollectionTask {
    dictionaries: Vec<Dictionary>,
    concurrency: usize,
    pool: Arc<rayon::ThreadPool>,
    query: String,
    stage: Stage,
    limit: usize,
}

impl CollectionTask {
    fn query_index(&self, index: &DidxIndex) -> mdict::Result<Vec<IndexMatch>> {
        let limit = Some(self.limit);
        match self.stage {
            Stage::Normal => {
                // Same work as DidxQueryService.normalCandidates, including reading
                // all exact matches before applying the per-dictionary limit.
                let (exact, (loose, prefix)) = rayon::join(
                    || index.exact(&self.query, None),
                    || {
                        rayon::join(
                            || index.loose(&self.query, limit),
                            || index.prefix(&self.query, limit),
                        )
                    },
                );
                let mut matches = exact?;
                matches.truncate(self.limit);
                matches.extend(loose?);
                matches.extend(prefix?);
                Ok(matches)
            }
            Stage::Wildcard => index.wildcard(&self.query, limit),
            Stage::Fuzzy => index.fuzzy(&self.query, None, limit),
        }
    }
}

impl Task for CollectionTask {
    type Output = Vec<(u32, Vec<IndexMatch>)>;
    type JsValue = Vec<DictionaryMatch>;

    fn compute(&mut self) -> Result<Self::Output> {
        let next = AtomicUsize::new(0);
        self.pool.install(|| {
            // At most `concurrency` active dictionaries, with dynamic assignment,
            // like the real JS mapWithConcurrency. Rayon threads persist across queries.
            let groups = (0..self.concurrency.min(self.dictionaries.len()))
                .into_par_iter()
                .map(|_| {
                    let mut output = Vec::new();
                    loop {
                        let position = next.fetch_add(1, Ordering::Relaxed);
                        let Some((id, index)) = self.dictionaries.get(position) else {
                            break;
                        };
                        output.push((
                            position,
                            *id,
                            self.query_index(index).map_err(to_napi_error)?,
                        ));
                    }
                    Ok(output)
                })
                .collect::<Result<Vec<Vec<_>>>>()?;
            let mut groups: Vec<_> = groups.into_iter().flatten().collect();
            groups.sort_unstable_by_key(|g| g.0);
            Ok(groups.into_iter().map(|(_, id, hits)| (id, hits)).collect())
        })
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output
            .into_iter()
            .flat_map(|(dictionary_id, hits)| {
                hits.into_iter().map(move |hit| DictionaryMatch {
                    dictionary_id,
                    key_text: hit.key_text,
                    normalized_key: hit.normalized_key,
                    locator: hit.locator.into(),
                    key_ordinal: hit.key_ordinal,
                    match_kind: hit.match_kind.as_str().to_owned(),
                    distance: hit.distance,
                })
            })
            .collect())
    }
}

fn to_napi_error(error: mdict::Error) -> Error {
    Error::from_reason(error.to_string())
}
