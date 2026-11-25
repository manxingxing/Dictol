/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const { mkdirSync, readFileSync, statSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { parseArgs } = require('node:util')
const { root, stats } = require('./harness.cjs')

const { values } = parseArgs({
  options: {
    dataset: { type: 'string' },
    output: { type: 'string' },
    counts: { type: 'string' },
    threads: { type: 'string', default: '4,8' },
    limits: { type: 'string', default: '50' },
    rounds: { type: 'string', default: '5' },
    repetitions: { type: 'string', default: '5' },
    warmup: { type: 'string', default: '2' },
    query: { type: 'string', multiple: true }
  }
})

function integer(value, name, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new Error(`${name} must be an integer in [${minimum}, ${maximum}]`)
  }
  return result
}

function hash(filename) {
  return createHash('sha256').update(readFileSync(filename)).digest('hex')
}

function command() {
  return (
    'node tests/native/didx-query-benchmark/compare-candidates.cjs ' +
    process.argv
      .slice(2)
      .map((arg) => `'${arg.replaceAll("'", "''")}'`)
      .join(' ')
  )
}

function runWorker(config, uvThreads) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(__dirname, 'candidates-worker.cjs'), JSON.stringify(config)],
      {
        env: { ...process.env, UV_THREADPOOL_SIZE: String(uvThreads) },
        stdio: 'inherit'
      }
    )
    child.on('error', reject)
    child.on('exit', (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`candidates worker failed: code=${code}, signal=${signal}`))
    )
  })
}

function means(entries) {
  if (!entries.length) return '— | — | —'
  const before = stats(entries.flatMap((entry) => entry.baseline)).meanMs
  const after = stats(entries.flatMap((entry) => entry.combined)).meanMs
  return `${before.toFixed(3)} | ${after.toFixed(3)} | ${(before / after).toFixed(2)}×`
}

function cell(value) {
  return JSON.stringify(value).replaceAll('|', '\\|')
}

function report(data) {
  const lines = [
    '# Node candidate() 与 Rust candidates() 对照',
    '',
    `数据：${data.dataset}；生成时间（UTC）：${data.startedAt}；${data.config.rounds} 轮 × 每词 ${data.config.repetitions} 次，另预热 ${data.config.warmup} 次。`,
    '',
    `机器：${data.environment.cpu}，${data.environment.logicalCpus} 逻辑处理器；${data.environment.platform} ${data.environment.arch}；Node ${data.environment.node}；release addon。`,
    '',
    '## 对照路径',
    '',
    '- Node：直接执行正式 DidxQueryService.candidate()，每词典 exact/loose/prefix 并发，所有词典合并为空时才全局 fuzzy；支持的通配符改走 wildcard。',
    '- Rust API：每本词典直接调用现有 DidxIndex.candidates(query, limit)，在单个 Rust 任务里依次执行 exact/loose/prefix、单词典排序去重及 fuzzy 补足。没有为通配符添加改道，也没有修改 Rust 算法。',
    '- 多词典时，两边都用正式 queryEach 的 8 本词典并发上限；Rust API 返回后复用正式 mergeCandidates 全局排序、去重、截断及 dictionaryIds 聚合。这个适配是为了得到可比较的多词典候选列表。',
    '- 双方使用同一 addon 中的生产解析器和绑定，分别持有独立打开的同一批索引；相同 UV_THREADPOOL_SIZE；每次请求交替先后执行，轮间轮换词序。没有新增 Rayon 调度。',
    '- 计时包含从 Node 调用到最终全局候选结果的全部处理，不含索引打开、预热、结果比较、Electron IPC/UI。OS 页缓存未清空。',
    '- 完整相同：全部候选字段及顺序深比较；界面相同：实际 searchDictionaryEntries 返回的 word、normalizedWord、dictionaryIds 及顺序相同。',
    '- 每次请求都比较，并检查每条路径自身结果在各次运行中保持不变。两种算法之间不一致会记录，不会被当成错误跳过或自动修正。',
    '',
    '## 汇总',
    '',
    '每个查询词等权。全部查询的耗时同时包含结果不等价的情况，只能作为工作负载成本比较；“完全相同子集”才是本样本中相同结果下的耗时比较。加速比=Node/Rust API，大于 1 表示 Rust API 更快。',
    '',
    '| UV线程 | 词典数 | limit | 完全相同/总数 | 界面相同/总数 | 全部 Node ms | 全部 Rust API ms | 加速比 | 相同子集 Node ms | 相同子集 Rust API ms | 加速比 |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
  ]
  for (const profile of data.profiles) {
    for (const count of data.config.counts) {
      for (const limit of data.config.limits) {
        const entries = profile.results.filter((e) => e.count === count && e.limit === limit)
        const equal = entries.filter((e) => e.comparison.fullEqual)
        const display = entries.filter((e) => e.comparison.displayEqual)
        lines.push(
          `| ${profile.uvThreads} | ${count} | ${limit} | ${equal.length}/${entries.length} | ${display.length}/${entries.length} | ${means(entries)} | ${means(equal)} |`
        )
      }
    }
  }
  lines.push('', '## 逐词结果', '', 'P50/P95 单位为 ms。相同列为“完整字段 / 界面字段”。', '')
  for (const profile of data.profiles) {
    lines.push(
      `### UV=${profile.uvThreads}`,
      '',
      '| 词典数 | limit | 查询 | Node/Rust 候选数 | 相同 | Node均值 | Rust均值 | Node P50/P95 | Rust P50/P95 | 加速比 |',
      '| ---: | ---: | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |'
    )
    for (const entry of profile.results) {
      const n = entry.baselineStats
      const r = entry.combinedStats
      const c = entry.comparison
      lines.push(
        `| ${entry.count} | ${entry.limit} | ${cell(entry.query)} | ${c.baselineCount}/${c.combinedCount} | ${c.fullEqual ? '是' : '否'}/${c.displayEqual ? '是' : '否'} | ${n.meanMs.toFixed(3)} | ${r.meanMs.toFixed(3)} | ${n.p50Ms.toFixed(3)}/${n.p95Ms.toFixed(3)} | ${r.p50Ms.toFixed(3)}/${r.p95Ms.toFixed(3)} | ${entry.speedup.toFixed(2)}× |`
      )
    }
    lines.push('')
  }
  lines.push(
    '## 差异明细',
    '',
    '每项只展示前 10 个增删词和前 5 个共同词的字段变化；完整输出、locator、排序与差异均保存在 results.json。',
    ''
  )
  for (const profile of data.profiles) {
    for (const entry of profile.results.filter((e) => !e.comparison.fullEqual)) {
      const c = entry.comparison
      lines.push(
        `### UV=${profile.uvThreads} / ${entry.count} 本 / limit=${entry.limit} / ${cell(entry.query)}`,
        '',
        `Node ${c.baselineCount} 项，Rust API ${c.combinedCount} 项；界面字段${c.displayEqual ? '相同' : '不同'}；词序${c.wordsEqual ? '相同' : '不同'}。`,
        '',
        `- Rust 多出的词（${c.added.length}）：${cell(c.added.slice(0, 10))}`,
        `- Rust 缺少的词（${c.removed.length}）：${cell(c.removed.slice(0, 10))}`,
        `- 共同词字段变化：${c.changed.length} 项。`,
        ''
      )
      for (const change of c.changed.slice(0, 5)) {
        const summarize = (hit) => ({
          dictionaryId: hit.dictionaryId,
          dictionaryIds: hit.dictionaryIds,
          matchKind: hit.matchKind,
          distance: hit.distance,
          keyOrdinal: String(hit.keyOrdinal),
          locatorHex: Buffer.from(hit.locator.data).toString('hex')
        })
        lines.push(
          `  - ${cell(change.word)}：位置 ${change.baselinePosition}→${change.combinedPosition}；Node ${cell(summarize(change.baseline))}；Rust API ${cell(summarize(change.combined))}`
        )
      }
      lines.push('')
    }
  }
  lines.push(
    '## 限制与复现',
    '',
    '- 当前 Rust API 与 Node 的 fuzzy 触发时机、全局最优距离筛选、通配符处理、每词典截断及去重范围不同，不能仅从调用次数判定等价。',
    '- 本结果不评估修改 Rust 算法后的性能，也不包含全 Rust 索引集合、冷启动、内存、取消、多个查询同时执行、后台线程池竞争及 Electron/UI。',
    '- 这是固定查询集和索引集合的样本，一致性比例不能推广为所有输入的通过率。原始 JSON 包含各次延迟、各轮统计、两边完整候选、差异及索引/源码/addon 哈希。',
    '',
    '```powershell',
    data.command,
    '```',
    ''
  )
  return lines.join('\n')
}

async function main() {
  if (!values.dataset) throw new Error('--dataset must point to a previous benchmark results.json')
  const datasetPath = path.resolve(values.dataset)
  const previous = JSON.parse(readFileSync(datasetPath, 'utf8'))
  if (!Array.isArray(previous.indexes) || previous.indexes.length === 0)
    throw new Error('Dataset has no indexes')
  const paths = previous.indexes.map((index) => {
    if (typeof index.path !== 'string' || !index.path.endsWith('.didx'))
      throw new Error('Invalid index path')
    if (statSync(index.path).size !== index.bytes || hash(index.path) !== index.sha256) {
      throw new Error(`Dataset index changed: ${index.path}`)
    }
    return index.path
  })
  const parseList = (value, name, minimum, maximum) =>
    value.split(',').map((n) => integer(n, name, minimum, maximum))
  const counts = values.counts
    ? parseList(values.counts, 'counts', 1, paths.length)
    : previous.config.counts
  const threads = parseList(values.threads, 'threads', 1, 128)
  const limits = parseList(values.limits, 'limits', 0, 10_000)
  const queries = values.query ?? previous.config.queries
  if (
    !Array.isArray(queries) ||
    !queries.length ||
    queries.some((q) => typeof q !== 'string' || !q.trim() || q.length > 4096)
  ) {
    throw new Error('Queries must be nonempty strings, at most 4096 UTF-16 units')
  }
  const config = {
    counts,
    limits,
    queries,
    concurrency: 8,
    rounds: integer(values.rounds, 'rounds', 2),
    repetitions: integer(values.repetitions, 'repetitions', 1),
    warmup: integer(values.warmup, 'warmup', 1)
  }
  const nativeSources = Object.keys(previous.sourceHashes).filter((file) =>
    file.startsWith('native/')
  )
  for (const file of nativeSources) {
    if (hash(path.join(root, file)) !== previous.sourceHashes[file]) {
      throw new Error(
        `Native source differs from dataset build; rebuild and regenerate dataset: ${file}`
      )
    }
  }
  if (
    hash(path.join(__dirname, 'benchmark.node')) !==
    previous.sourceHashes['tests/native/didx-query-benchmark/benchmark.node']
  ) {
    throw new Error('Addon differs from dataset build; regenerate the dataset metadata first')
  }
  const files = [
    'src/main/didx-query-service.ts',
    ...nativeSources,
    ...[
      'compare-candidates.cjs',
      'candidates-harness.cjs',
      'candidates-worker.cjs',
      'harness.cjs',
      'Cargo.lock',
      'benchmark.node'
    ].map((file) => `tests/native/didx-query-benchmark/${file}`)
  ]
  const output = path.resolve(
    values.output ??
      path.join(
        __dirname,
        'output',
        `candidates-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`
      )
  )
  mkdirSync(output, { recursive: true })
  const data = {
    startedAt: new Date().toISOString(),
    command: command(),
    dataset: previous.dataset,
    datasetPath,
    config,
    indexes: previous.indexes,
    environment: {
      cpu: os.cpus()[0].model,
      logicalCpus: os.cpus().length,
      platform: process.platform,
      arch: process.arch,
      node: process.version
    },
    sourceHashes: Object.fromEntries(files.map((file) => [file, hash(path.join(root, file))])),
    profiles: []
  }
  for (const uvThreads of threads) {
    const resultPath = path.join(output, `uv-${uvThreads}.json`)
    await runWorker({ ...config, paths, resultPath }, uvThreads)
    data.profiles.push(JSON.parse(readFileSync(resultPath, 'utf8')))
  }
  data.completedAt = new Date().toISOString()
  writeFileSync(path.join(output, 'results.json'), JSON.stringify(data, null, 2))
  writeFileSync(path.join(output, 'report.md'), report(data))
  console.log(`Candidates report: ${path.join(output, 'report.md')}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
