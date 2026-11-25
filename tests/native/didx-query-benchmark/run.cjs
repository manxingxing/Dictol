/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { execFileSync, spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { parseArgs } = require('node:util')
const { addon, root, stats } = require('./harness.cjs')

const { values } = parseArgs({
  options: {
    'index-root': { type: 'string' },
    manifest: { type: 'string' },
    output: { type: 'string' },
    counts: { type: 'string' },
    profiles: { type: 'string', default: '4:4,8:8,4:8' },
    rounds: { type: 'string', default: '5' },
    repetitions: { type: 'string', default: '5' },
    warmup: { type: 'string', default: '2' },
    limit: { type: 'string', default: '50' },
    dictionaries: { type: 'string', default: '24' },
    entries: { type: 'string', default: '10000' },
    query: { type: 'string', multiple: true }
  }
})

function integer(value, name, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new Error(`${name} must be an integer in [${minimum}, ${maximum}]`)
  }
  return result
}

function findIndexes(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const filename = path.join(directory, entry.name)
      return entry.isDirectory()
        ? findIndexes(filename)
        : entry.name.endsWith('.didx')
          ? [filename]
          : []
    })
    .sort()
}

async function generateIndexes(directory, dictionaries, entries) {
  mkdirSync(directory, { recursive: true })
  const words = [
    'apple',
    'Apple',
    'apple',
    'apples',
    'application',
    'apply',
    'app',
    'hello',
    'help',
    'abandon',
    'run',
    'running',
    'a',
    'a-b',
    'ab',
    'ápple',
    'café',
    '中文',
    '中文词典',
    'trans',
    'translate',
    'translation',
    'word',
    'word form',
    'Ａpple',
    '😀',
    '😀word'
  ]
  const paths = []
  for (let dictionary = 0; dictionary < dictionaries; dictionary++) {
    const keys = [...words]
    for (let i = 0; i < entries; i++) {
      keys.push(i % 5 === 0 ? `dict${dictionary}-${i}` : `word${String(i).padStart(6, '0')}`)
    }
    const filename = path.join(directory, `${String(dictionary + 1).padStart(3, '0')}.didx`)
    await addon.DidxIndex.build(
      keys.map((keyText, ordinal) => ({
        keyText,
        locator: Buffer.from(`${dictionary}:${ordinal}`)
      })),
      BigInt(dictionary + 1),
      filename
    )
    paths.push(filename)
  }
  return paths
}

function runWorker(config, uvThreads) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(__dirname, 'worker.cjs'), JSON.stringify(config)],
      {
        env: { ...process.env, UV_THREADPOOL_SIZE: String(uvThreads) },
        stdio: 'inherit'
      }
    )
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Worker exited: ${code}`))
    )
  })
}

function json(value) {
  return JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? item.toString() : item), 2)
}

function hash(filename) {
  return createHash('sha256').update(readFileSync(filename)).digest('hex')
}

function sourceFiles(directory) {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const filename = `${directory}/${entry.name}`
    return entry.isDirectory() ? sourceFiles(filename) : [filename]
  })
}

function report(data) {
  const lines = [
    '# DIDX 并发查询 benchmark',
    '',
    `生成时间：${data.startedAt}；数据：${data.dataset}；结果一致性：全部计时请求及预热请求均通过完整对象深比较。`,
    '',
    `机器：${data.environment.cpu}，${data.environment.logicalCpus} 逻辑处理器；${data.environment.platform} ${data.environment.arch} ${data.environment.osRelease}；Node ${data.environment.node}；${data.environment.rustc}。`,
    '',
    `Release 构建；词典并发上限 8；limit=${data.config.limit}；${data.config.rounds} 轮 × 每词 ${data.config.repetitions} 次，另预热 ${data.config.warmup} 次。单个查询逐次执行。`,
    '',
    '## 测量范围',
    '',
    '- Node 基线直接执行当前 DidxQueryService.candidate()，不是简化仿写。',
    '- Rust 版本持有全部索引，正常阶段并发 exact/loose/prefix；每阶段只跨一次 N-API。用持久 Rayon 线程池执行，仍由一个 libuv AsyncTask 进入 Rust。',
    '- 双方使用同一 release addon 内的生产解析器、生产单词典绑定；排序、去重、fuzzy 回退复用同一份生产 JS 代码。未迁移排序和去重到 Rust。',
    '- 包含原生查询、线程调度、N-API 结果转换、JS 合并、排序和去重。不含索引打开、文件构建、词典增减、Electron IPC、renderer 和 UI。',
    '- 两边分别打开相同文件，使用独立索引对象；预热后交替先后顺序，轮间轮换词序。不清空操作系统页缓存，因此是热缓存测试。',
    '- UV/Rust 线程数相同的行用于等线程比较；UV=4/Rust=8 的行包含扩大线程池的效果，不能全部归因于跨语言调用减少。',
    '',
    '## 汇总',
    '',
    '每个查询词等权；均值为全部计时请求平均延迟；加速比=Node 均值/Rust 均值，大于 1 表示 Rust 更快。轮次范围为每轮整体均值加速比的最小值至最大值，不是置信区间。',
    '',
    '| 词典数 | UV线程 | Rust线程 | Node均值 ms | Rust均值 ms | 加速比 | 延迟降低 | 轮次加速比范围 |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
  ]
  for (const profile of data.profiles) {
    for (const count of data.config.counts) {
      const entries = profile.results.filter((entry) => entry.count === count)
      const node = stats(entries.flatMap((entry) => entry.node)).meanMs
      const rust = stats(entries.flatMap((entry) => entry.rust)).meanMs
      const ratios = Array.from({ length: data.config.rounds }, (_, round) => {
        const n = entries.reduce((sum, entry) => sum + entry.rounds[round].node.meanMs, 0)
        const r = entries.reduce((sum, entry) => sum + entry.rounds[round].rust.meanMs, 0)
        return n / r
      })
      lines.push(
        `| ${count} | ${profile.uvThreads} | ${profile.rustThreads} | ${node.toFixed(3)} | ${rust.toFixed(3)} | ${(node / rust).toFixed(2)}× | ${((1 - rust / node) * 100).toFixed(1)}% | ${Math.min(...ratios).toFixed(2)}–${Math.max(...ratios).toFixed(2)}× |`
      )
    }
  }
  lines.push('', '## 分查询结果', '', 'P50/P95 为单词、单配置下单次请求的延迟分位数，单位 ms。', '')
  for (const profile of data.profiles) {
    lines.push(
      `### UV=${profile.uvThreads} / Rust=${profile.rustThreads}`,
      '',
      '| 词典数 | 查询 | 候选数 | Node均值 | Rust均值 | Node P50/P95 | Rust P50/P95 | 加速比 |',
      '| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |'
    )
    for (const entry of profile.results) {
      const n = entry.nodeStats
      const r = entry.rustStats
      lines.push(
        `| ${entry.count} | ${JSON.stringify(entry.query).replaceAll('|', '\\|')} | ${entry.candidateCount} | ${n.meanMs.toFixed(3)} | ${r.meanMs.toFixed(3)} | ${n.p50Ms.toFixed(3)}/${n.p95Ms.toFixed(3)} | ${r.p50Ms.toFixed(3)}/${r.p95Ms.toFixed(3)} | ${entry.speedup.toFixed(2)}× |`
      )
    }
    lines.push('')
  }
  lines.push(
    '## 限制与复现',
    '',
    '- 这是评估并发下移的实验实现，尚未接入正式 DictionaryIndexManager。增删替换与进行中任务的快照语义有独立验证；真实 Windows 文件删除等待、启用/禁用、词典分组和应用生命周期未接入。',
    '- 每词典返回的原始结果仍全部传给 JS；实际输入频率、查询取消、多个请求同时进行、后台线程池竞争、冷启动和内存占用未测量。',
    '- 通配、拼写纠错与大量 prefix 返回的成本不同；汇总依赖此处查询词的比例，不能直接当作所有用户的平均收益。',
    '- 本机测试会受系统调度、温度和其他进程影响。小于毫秒的差值尤其需要多次独立进程复测。',
    '- 原始逐次延迟、每轮统计、完整参数、索引大小/元数据/SHA-256、源码和 addon SHA-256 在同目录 results.json。',
    '',
    '```powershell',
    data.command,
    '```',
    ''
  )
  return lines.join('\n')
}

async function main() {
  if (values['index-root'] && values.manifest) throw new Error('Choose --index-root or --manifest')
  const rounds = integer(values.rounds, 'rounds', 2)
  const repetitions = integer(values.repetitions, 'repetitions')
  const warmup = integer(values.warmup, 'warmup')
  const limit = integer(values.limit, 'limit', 0, 10_000)
  const profiles = values.profiles.split(',').map((profile) => {
    const parts = profile.split(':')
    if (parts.length !== 2) throw new Error('profiles format: UV:Rust,UV:Rust')
    return {
      uv: integer(parts[0], 'UV threads', 1, 128),
      threads: integer(parts[1], 'Rust threads', 1, 128)
    }
  })
  const output = path.resolve(
    values.output ??
      path.join(__dirname, 'output', new Date().toISOString().replaceAll(/[:.]/g, '-'))
  )
  mkdirSync(output, { recursive: true })
  const synthetic = !values['index-root'] && !values.manifest
  let paths = synthetic
    ? await generateIndexes(
        path.join(output, 'indexes'),
        integer(values.dictionaries, 'dictionaries'),
        integer(values.entries, 'entries')
      )
    : values.manifest
      ? JSON.parse(readFileSync(path.resolve(values.manifest), 'utf8'))
      : findIndexes(path.resolve(values['index-root']))
  if (
    !Array.isArray(paths) ||
    !paths.length ||
    paths.some((item) => typeof item !== 'string' || !item.endsWith('.didx'))
  ) {
    throw new Error('Dataset must contain one or more .didx paths')
  }
  const manifestBase = values.manifest ? path.dirname(path.resolve(values.manifest)) : process.cwd()
  paths = paths.map((item) => path.resolve(manifestBase, item))
  if (new Set(paths).size !== paths.length) throw new Error('Duplicate index paths are not allowed')
  const counts = values.counts
    ? values.counts.split(',').map((item) => integer(item, 'count', 1, paths.length))
    : [...new Set([1, Math.min(8, paths.length), paths.length])]
  const queries = values.query ?? [
    'apple',
    'hello',
    'abandon',
    'app',
    'trans',
    'a',
    'word',
    'app*',
    'a??',
    'applf',
    'helo',
    'zzqvxtest',
    '中文'
  ]
  if (queries.some((q) => !q.trim() || q.length > 4096))
    throw new Error('Queries must be nonempty and at most 4096 UTF-16 units')
  const indexes = paths.map((filename) => {
    const index = addon.DidxIndex.open(filename)
    try {
      return {
        path: filename,
        bytes: statSync(filename).size,
        sha256: hash(filename),
        metadata: index.metadata
      }
    } finally {
      index.close()
    }
  })
  const data = {
    startedAt: new Date().toISOString(),
    dataset: synthetic ? 'synthetic' : 'real DIDX',
    command:
      'node tests/native/didx-query-benchmark/run.cjs ' +
      process.argv
        .slice(2)
        .map((a) => `'${a.replaceAll("'", "''")}'`)
        .join(' '),
    environment: {
      cpu: os.cpus()[0].model,
      logicalCpus: os.cpus().length,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      node: process.version,
      rustc: execFileSync('rustc', ['--version'], { encoding: 'utf8' }).trim()
    },
    config: { rounds, repetitions, warmup, limit, counts, queries, concurrency: 8 },
    indexes,
    sourceHashes: Object.fromEntries(
      [
        'src/main/didx-query-service.ts',
        ...sourceFiles('native/mdict/src'),
        ...sourceFiles('native/mdict-node/src'),
        ...sourceFiles('tests/native/didx-query-benchmark/src'),
        'tests/native/didx-query-benchmark/run.cjs',
        'tests/native/didx-query-benchmark/harness.cjs',
        'tests/native/didx-query-benchmark/worker.cjs',
        'tests/native/didx-query-benchmark/Cargo.lock',
        'tests/native/didx-query-benchmark/benchmark.node'
      ].map((filename) => [filename, hash(path.join(root, filename))])
    ),
    profiles: []
  }
  for (const [position, profile] of profiles.entries()) {
    const resultPath = path.join(output, `profile-${position}.json`)
    await runWorker({ ...data.config, paths, threads: profile.threads, resultPath }, profile.uv)
    data.profiles.push(JSON.parse(readFileSync(resultPath, 'utf8')))
  }
  data.completedAt = new Date().toISOString()
  writeFileSync(path.join(output, 'results.json'), json(data))
  writeFileSync(path.join(output, 'report.md'), report(data))
  console.log(`Report: ${path.join(output, 'report.md')}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
