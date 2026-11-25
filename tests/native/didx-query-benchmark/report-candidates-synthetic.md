# Node candidate() 与 Rust candidates() 对照

数据：synthetic；生成时间（UTC）：2026-11-24T13:35:12.246Z；5 轮 × 每词 5 次，另预热 2 次。

机器：Intel(R) Core(TM) Ultra 7 165H，22 逻辑处理器；win32 x64；Node v26.4.0；release addon。

## 对照路径

- Node：直接执行正式 DidxQueryService.candidate()，每词典 exact/loose/prefix 并发，所有词典合并为空时才全局 fuzzy；支持的通配符改走 wildcard。
- Rust API：每本词典直接调用现有 DidxIndex.candidates(query, limit)，在单个 Rust 任务里依次执行 exact/loose/prefix、单词典排序去重及 fuzzy 补足。没有为通配符添加改道，也没有修改 Rust 算法。
- 多词典时，两边都用正式 queryEach 的 8 本词典并发上限；Rust API 返回后复用正式 mergeCandidates 全局排序、去重、截断及 dictionaryIds 聚合。这个适配是为了得到可比较的多词典候选列表。
- 双方使用同一 addon 中的生产解析器和绑定，分别持有独立打开的同一批索引；相同 UV_THREADPOOL_SIZE；每次请求交替先后执行，轮间轮换词序。没有新增 Rayon 调度。
- 计时包含从 Node 调用到最终全局候选结果的全部处理，不含索引打开、预热、结果比较、Electron IPC/UI。OS 页缓存未清空。
- 完整相同：全部候选字段及顺序深比较；界面相同：实际 searchDictionaryEntries 返回的 word、normalizedWord、dictionaryIds 及顺序相同。
- 每次请求都比较，并检查每条路径自身结果在各次运行中保持不变。两种算法之间不一致会记录，不会被当成错误跳过或自动修正。

## 汇总

每个查询词等权。全部查询的耗时同时包含结果不等价的情况，只能作为工作负载成本比较；“完全相同子集”才是本样本中相同结果下的耗时比较。加速比=Node/Rust API，大于 1 表示 Rust API 更快。

| UV线程 | 词典数 | limit | 完全相同/总数 | 界面相同/总数 | 全部 Node ms | 全部 Rust API ms | 加速比 | 相同子集 Node ms | 相同子集 Rust API ms | 加速比 |
| -----: | -----: | ----: | ------------: | ------------: | -----------: | ---------------: | -----: | ---------------: | -------------------: | -----: |
|      4 |      1 |    50 |         11/13 |         11/13 |        0.140 |            0.138 |  1.01× |            0.151 |                0.143 |  1.05× |
|      4 |      8 |    50 |         11/13 |         11/13 |        0.324 |            0.314 |  1.03× |            0.355 |                0.328 |  1.08× |
|      4 |     24 |    50 |         11/13 |         11/13 |        1.110 |            0.974 |  1.14× |            1.226 |                1.022 |  1.20× |
|      8 |      1 |    50 |         11/13 |         11/13 |        0.121 |            0.126 |  0.96× |            0.132 |                0.131 |  1.01× |
|      8 |      8 |    50 |         11/13 |         11/13 |        0.405 |            0.407 |  0.99× |            0.434 |                0.417 |  1.04× |
|      8 |     24 |    50 |         11/13 |         11/13 |        1.152 |            0.999 |  1.15× |            1.267 |                1.025 |  1.24× |

## 逐词结果

P50/P95 单位为 ms。相同列为“完整字段 / 界面字段”。

### UV=4

| 词典数 | limit | 查询        | Node/Rust 候选数 | 相同  | Node均值 | Rust均值 | Node P50/P95 | Rust P50/P95 | 加速比 |
| -----: | ----: | ----------- | ---------------: | ----- | -------: | -------: | -----------: | -----------: | -----: |
|      1 |    50 | "apple"     |              4/4 | 是/是 |    0.126 |    0.117 |  0.087/0.143 |  0.095/0.202 |  1.08× |
|      1 |    50 | "hello"     |              1/1 | 是/是 |    0.056 |    0.075 |  0.046/0.124 |  0.061/0.142 |  0.75× |
|      1 |    50 | "abandon"   |              1/1 | 是/是 |    0.047 |    0.066 |  0.043/0.082 |  0.065/0.089 |  0.71× |
|      1 |    50 | "app"       |              5/5 | 是/是 |    0.152 |    0.092 |  0.073/0.145 |  0.090/0.119 |  1.66× |
|      1 |    50 | "trans"     |              3/3 | 是/是 |    0.086 |    0.101 |  0.086/0.155 |  0.091/0.149 |  0.85× |
|      1 |    50 | "a"         |              8/8 | 是/是 |    0.105 |    0.109 |  0.098/0.164 |  0.107/0.143 |  0.96× |
|      1 |    50 | "word"      |            50/50 | 是/是 |    0.729 |    0.734 |  0.706/0.863 |  0.714/0.876 |  0.99× |
|      1 |    50 | "app*"      |              5/5 | 否/否 |    0.077 |    0.102 |  0.075/0.115 |  0.098/0.147 |  0.75× |
|      1 |    50 | "a??"       |              2/8 | 否/否 |    0.077 |    0.116 |  0.071/0.142 |  0.108/0.169 |  0.66× |
|      1 |    50 | "applf"     |              2/2 | 是/是 |    0.123 |    0.087 |  0.102/0.178 |  0.078/0.159 |  1.42× |
|      1 |    50 | "helo"      |              2/2 | 是/是 |    0.108 |    0.074 |  0.097/0.160 |  0.071/0.106 |  1.45× |
|      1 |    50 | "zzqvxtest" |              0/0 | 是/是 |    0.080 |    0.047 |  0.075/0.108 |  0.042/0.072 |  1.70× |
|      1 |    50 | "中文"      |              2/2 | 是/是 |    0.047 |    0.073 |  0.045/0.076 |  0.071/0.107 |  0.65× |
|      8 |    50 | "apple"     |              4/4 | 是/是 |    0.229 |    0.205 |  0.221/0.318 |  0.188/0.275 |  1.12× |
|      8 |    50 | "hello"     |              1/1 | 是/是 |    0.108 |    0.111 |  0.091/0.194 |  0.097/0.152 |  0.97× |
|      8 |    50 | "abandon"   |              1/1 | 是/是 |    0.110 |    0.106 |  0.094/0.145 |  0.090/0.151 |  1.04× |
|      8 |    50 | "app"       |              5/5 | 是/是 |    0.180 |    0.180 |  0.174/0.202 |  0.169/0.237 |  1.00× |
|      8 |    50 | "trans"     |              3/3 | 是/是 |    0.177 |    0.204 |  0.148/0.463 |  0.190/0.331 |  0.87× |
|      8 |    50 | "a"         |              8/8 | 是/是 |    0.255 |    0.273 |  0.247/0.339 |  0.271/0.394 |  0.94× |
|      8 |    50 | "word"      |            50/50 | 是/是 |    2.098 |    2.042 |  2.064/2.544 |  1.949/2.502 |  1.03× |
|      8 |    50 | "app*"      |              5/5 | 否/否 |    0.191 |    0.209 |  0.171/0.292 |  0.189/0.273 |  0.91× |
|      8 |    50 | "a??"       |              2/8 | 否/否 |    0.112 |    0.267 |  0.095/0.203 |  0.243/0.394 |  0.42× |
|      8 |    50 | "applf"     |              2/2 | 是/是 |    0.229 |    0.152 |  0.203/0.329 |  0.139/0.202 |  1.51× |
|      8 |    50 | "helo"      |              2/2 | 是/是 |    0.230 |    0.160 |  0.190/0.373 |  0.142/0.200 |  1.44× |
|      8 |    50 | "zzqvxtest" |              0/0 | 是/是 |    0.145 |    0.063 |  0.116/0.236 |  0.057/0.087 |  2.30× |
|      8 |    50 | "中文"      |              2/2 | 是/是 |    0.147 |    0.109 |  0.138/0.203 |  0.103/0.148 |  1.35× |
|     24 |    50 | "apple"     |              4/4 | 是/是 |    0.806 |    0.624 |  0.768/0.969 |  0.615/0.751 |  1.29× |
|     24 |    50 | "hello"     |              1/1 | 是/是 |    0.382 |    0.252 |  0.383/0.494 |  0.243/0.335 |  1.51× |
|     24 |    50 | "abandon"   |              1/1 | 是/是 |    0.409 |    0.244 |  0.369/0.608 |  0.210/0.418 |  1.68× |
|     24 |    50 | "app"       |              5/5 | 是/是 |    0.765 |    0.603 |  0.686/1.090 |  0.530/0.978 |  1.27× |
|     24 |    50 | "trans"     |              3/3 | 是/是 |    0.616 |    0.681 |  0.512/1.144 |  0.515/1.585 |  0.90× |
|     24 |    50 | "a"         |              8/8 | 是/是 |    1.399 |    1.037 |  0.923/3.931 |  0.814/2.205 |  1.35× |
|     24 |    50 | "word"      |            50/50 | 是/是 |    6.593 |    6.280 |  5.843/8.759 |  6.053/7.869 |  1.05× |
|     24 |    50 | "app*"      |              5/5 | 否/否 |    0.657 |    0.642 |  0.550/1.394 |  0.570/0.866 |  1.02× |
|     24 |    50 | "a??"       |              2/8 | 否/否 |    0.288 |    0.785 |  0.285/0.382 |  0.766/0.963 |  0.37× |
|     24 |    50 | "applf"     |              2/2 | 是/是 |    0.735 |    0.492 |  0.662/1.140 |  0.439/0.722 |  1.49× |
|     24 |    50 | "helo"      |              2/2 | 是/是 |    0.739 |    0.508 |  0.645/1.265 |  0.455/0.843 |  1.45× |
|     24 |    50 | "zzqvxtest" |              0/0 | 是/是 |    0.406 |    0.156 |  0.327/0.727 |  0.118/0.339 |  2.59× |
|     24 |    50 | "中文"      |              2/2 | 是/是 |    0.641 |    0.361 |  0.552/1.021 |  0.337/0.586 |  1.77× |

### UV=8

| 词典数 | limit | 查询        | Node/Rust 候选数 | 相同  | Node均值 | Rust均值 | Node P50/P95 | Rust P50/P95 | 加速比 |
| -----: | ----: | ----------- | ---------------: | ----- | -------: | -------: | -----------: | -----------: | -----: |
|      1 |    50 | "apple"     |              4/4 | 是/是 |    0.097 |    0.105 |  0.084/0.181 |  0.086/0.168 |  0.92× |
|      1 |    50 | "hello"     |              1/1 | 是/是 |    0.051 |    0.131 |  0.043/0.098 |  0.056/0.127 |  0.39× |
|      1 |    50 | "abandon"   |              1/1 | 是/是 |    0.055 |    0.066 |  0.049/0.086 |  0.068/0.091 |  0.83× |
|      1 |    50 | "app"       |              5/5 | 是/是 |    0.079 |    0.080 |  0.071/0.137 |  0.072/0.127 |  0.98× |
|      1 |    50 | "trans"     |              3/3 | 是/是 |    0.063 |    0.086 |  0.058/0.079 |  0.080/0.107 |  0.73× |
|      1 |    50 | "a"         |              8/8 | 是/是 |    0.085 |    0.090 |  0.077/0.123 |  0.083/0.132 |  0.94× |
|      1 |    50 | "word"      |            50/50 | 是/是 |    0.724 |    0.650 |  0.716/0.931 |  0.622/0.788 |  1.11× |
|      1 |    50 | "app*"      |              5/5 | 否/否 |    0.061 |    0.099 |  0.058/0.082 |  0.077/0.260 |  0.62× |
|      1 |    50 | "a??"       |              2/8 | 否/否 |    0.061 |    0.090 |  0.050/0.112 |  0.079/0.145 |  0.67× |
|      1 |    50 | "applf"     |              2/2 | 是/是 |    0.082 |    0.059 |  0.077/0.116 |  0.053/0.083 |  1.39× |
|      1 |    50 | "helo"      |              2/2 | 是/是 |    0.097 |    0.068 |  0.089/0.150 |  0.068/0.098 |  1.41× |
|      1 |    50 | "zzqvxtest" |              0/0 | 是/是 |    0.076 |    0.045 |  0.058/0.102 |  0.038/0.067 |  1.69× |
|      1 |    50 | "中文"      |              2/2 | 是/是 |    0.045 |    0.064 |  0.038/0.066 |  0.053/0.094 |  0.71× |
|      8 |    50 | "apple"     |              4/4 | 是/是 |    0.272 |    0.231 |  0.258/0.360 |  0.221/0.363 |  1.17× |
|      8 |    50 | "hello"     |              1/1 | 是/是 |    0.187 |    0.134 |  0.158/0.329 |  0.124/0.195 |  1.39× |
|      8 |    50 | "abandon"   |              1/1 | 是/是 |    0.262 |    0.157 |  0.233/0.476 |  0.140/0.246 |  1.67× |
|      8 |    50 | "app"       |              5/5 | 是/是 |    0.251 |    0.363 |  0.248/0.348 |  0.207/0.373 |  0.69× |
|      8 |    50 | "trans"     |              3/3 | 是/是 |    0.209 |    0.221 |  0.201/0.348 |  0.200/0.319 |  0.95× |
|      8 |    50 | "a"         |              8/8 | 是/是 |    0.361 |    0.354 |  0.310/0.734 |  0.276/0.798 |  1.02× |
|      8 |    50 | "word"      |            50/50 | 是/是 |    2.154 |    2.513 |  2.018/2.630 |  2.137/5.227 |  0.86× |
|      8 |    50 | "app*"      |              5/5 | 否/否 |    0.298 |    0.313 |  0.208/0.570 |  0.238/0.400 |  0.95× |
|      8 |    50 | "a??"       |              2/8 | 否/否 |    0.185 |    0.389 |  0.110/0.300 |  0.323/0.449 |  0.48× |
|      8 |    50 | "applf"     |              2/2 | 是/是 |    0.335 |    0.185 |  0.303/0.556 |  0.165/0.272 |  1.81× |
|      8 |    50 | "helo"      |              2/2 | 是/是 |    0.375 |    0.206 |  0.281/0.484 |  0.180/0.370 |  1.82× |
|      8 |    50 | "zzqvxtest" |              0/0 | 是/是 |    0.185 |    0.087 |  0.172/0.203 |  0.074/0.147 |  2.12× |
|      8 |    50 | "中文"      |              2/2 | 是/是 |    0.188 |    0.138 |  0.187/0.225 |  0.114/0.274 |  1.36× |
|     24 |    50 | "apple"     |              4/4 | 是/是 |    1.054 |    0.837 |  1.008/1.613 |  0.772/1.223 |  1.26× |
|     24 |    50 | "hello"     |              1/1 | 是/是 |    0.541 |    0.319 |  0.517/0.829 |  0.306/0.485 |  1.70× |
|     24 |    50 | "abandon"   |              1/1 | 是/是 |    0.490 |    0.278 |  0.475/0.714 |  0.253/0.542 |  1.77× |
|     24 |    50 | "app"       |              5/5 | 是/是 |    0.885 |    0.656 |  0.754/1.449 |  0.630/1.146 |  1.35× |
|     24 |    50 | "trans"     |              3/3 | 是/是 |    0.685 |    0.549 |  0.657/0.896 |  0.523/0.899 |  1.25× |
|     24 |    50 | "a"         |              8/8 | 是/是 |    1.077 |    0.846 |  0.972/1.517 |  0.820/1.090 |  1.27× |
|     24 |    50 | "word"      |            50/50 | 是/是 |    6.093 |    6.107 |  5.851/7.279 |  6.062/6.832 |  1.00× |
|     24 |    50 | "app*"      |              5/5 | 否/否 |    0.707 |    0.718 |  0.609/1.524 |  0.583/1.419 |  0.98× |
|     24 |    50 | "a??"       |              2/8 | 否/否 |    0.331 |    0.987 |  0.292/0.603 |  0.807/1.979 |  0.34× |
|     24 |    50 | "applf"     |              2/2 | 是/是 |    0.800 |    0.480 |  0.765/1.038 |  0.482/0.569 |  1.67× |
|     24 |    50 | "helo"      |              2/2 | 是/是 |    0.864 |    0.604 |  0.801/1.213 |  0.541/0.905 |  1.43× |
|     24 |    50 | "zzqvxtest" |              0/0 | 是/是 |    0.520 |    0.183 |  0.469/0.792 |  0.179/0.262 |  2.84× |
|     24 |    50 | "中文"      |              2/2 | 是/是 |    0.929 |    0.419 |  0.652/3.075 |  0.348/0.825 |  2.22× |

## 差异明细

每项只展示前 10 个增删词和前 5 个共同词的字段变化；完整输出、locator、排序与差异均保存在 results.json。

### UV=4 / 1 本 / limit=50 / "app*"

Node 5 项，Rust API 5 项；界面字段不同；词序不同。

- Rust 多出的词（1）：["apple"]
- Rust 缺少的词（1）：["Apple"]
- 共同词字段变化：4 项。

  - "app"：位置 0→0；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"6","locatorHex":"303a36"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"loose","keyOrdinal":"6","locatorHex":"303a36"}
  - "apply"：位置 4→2；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"5","locatorHex":"303a35"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"5","locatorHex":"303a35"}
  - "apples"：位置 2→3；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"3","locatorHex":"303a33"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"3","locatorHex":"303a33"}
  - "application"：位置 3→4；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"4","locatorHex":"303a34"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"4","locatorHex":"303a34"}

### UV=4 / 1 本 / limit=50 / "a??"

Node 2 项，Rust API 8 项；界面字段不同；词序不同。

- Rust 多出的词（6）：["a","apple","apply","apples","abandon","application"]
- Rust 缺少的词（0）：[]
- 共同词字段变化：2 项。

  - "a-b"：位置 0→1；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"13","locatorHex":"303a3133"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"13","locatorHex":"303a3133"}
  - "app"：位置 1→2；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"6","locatorHex":"303a36"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"6","locatorHex":"303a36"}

### UV=4 / 8 本 / limit=50 / "app*"

Node 5 项，Rust API 5 项；界面字段不同；词序不同。

- Rust 多出的词（1）：["apple"]
- Rust 缺少的词（1）：["Apple"]
- 共同词字段变化：4 项。

  - "app"：位置 0→0；Node {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8],"matchKind":"wildcard","keyOrdinal":"6","locatorHex":"303a36"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8],"matchKind":"loose","keyOrdinal":"6","locatorHex":"303a36"}
  - "apply"：位置 4→2；Node {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8],"matchKind":"wildcard","keyOrdinal":"5","locatorHex":"303a35"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8],"matchKind":"prefix","keyOrdinal":"5","locatorHex":"303a35"}
  - "apples"：位置 2→3；Node {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8],"matchKind":"wildcard","keyOrdinal":"3","locatorHex":"303a33"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8],"matchKind":"prefix","keyOrdinal":"3","locatorHex":"303a33"}
  - "application"：位置 3→4；Node {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8],"matchKind":"wildcard","keyOrdinal":"4","locatorHex":"303a34"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8],"matchKind":"prefix","keyOrdinal":"4","locatorHex":"303a34"}

### UV=4 / 8 本 / limit=50 / "a??"

Node 2 项，Rust API 8 项；界面字段不同；词序不同。

- Rust 多出的词（6）：["a","apple","apply","apples","abandon","application"]
- Rust 缺少的词（0）：[]
- 共同词字段变化：2 项。

  - "a-b"：位置 0→1；Node {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8],"matchKind":"wildcard","keyOrdinal":"13","locatorHex":"303a3133"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8],"matchKind":"prefix","keyOrdinal":"13","locatorHex":"303a3133"}
  - "app"：位置 1→2；Node {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8],"matchKind":"wildcard","keyOrdinal":"6","locatorHex":"303a36"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8],"matchKind":"prefix","keyOrdinal":"6","locatorHex":"303a36"}

### UV=4 / 24 本 / limit=50 / "app*"

Node 5 项，Rust API 5 项；界面字段不同；词序不同。

- Rust 多出的词（1）：["apple"]
- Rust 缺少的词（1）：["Apple"]
- 共同词字段变化：4 项。

  - "app"：位置 0→0；Node {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"matchKind":"wildcard","keyOrdinal":"6","locatorHex":"303a36"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"matchKind":"loose","keyOrdinal":"6","locatorHex":"303a36"}
  - "apply"：位置 4→2；Node {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"matchKind":"wildcard","keyOrdinal":"5","locatorHex":"303a35"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"matchKind":"prefix","keyOrdinal":"5","locatorHex":"303a35"}
  - "apples"：位置 2→3；Node {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"matchKind":"wildcard","keyOrdinal":"3","locatorHex":"303a33"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"matchKind":"prefix","keyOrdinal":"3","locatorHex":"303a33"}
  - "application"：位置 3→4；Node {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"matchKind":"wildcard","keyOrdinal":"4","locatorHex":"303a34"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"matchKind":"prefix","keyOrdinal":"4","locatorHex":"303a34"}

### UV=4 / 24 本 / limit=50 / "a??"

Node 2 项，Rust API 8 项；界面字段不同；词序不同。

- Rust 多出的词（6）：["a","apple","apply","apples","abandon","application"]
- Rust 缺少的词（0）：[]
- 共同词字段变化：2 项。

  - "a-b"：位置 0→1；Node {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"matchKind":"wildcard","keyOrdinal":"13","locatorHex":"303a3133"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"matchKind":"prefix","keyOrdinal":"13","locatorHex":"303a3133"}
  - "app"：位置 1→2；Node {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"matchKind":"wildcard","keyOrdinal":"6","locatorHex":"303a36"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"matchKind":"prefix","keyOrdinal":"6","locatorHex":"303a36"}

### UV=8 / 1 本 / limit=50 / "app*"

Node 5 项，Rust API 5 项；界面字段不同；词序不同。

- Rust 多出的词（1）：["apple"]
- Rust 缺少的词（1）：["Apple"]
- 共同词字段变化：4 项。

  - "app"：位置 0→0；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"6","locatorHex":"303a36"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"loose","keyOrdinal":"6","locatorHex":"303a36"}
  - "apply"：位置 4→2；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"5","locatorHex":"303a35"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"5","locatorHex":"303a35"}
  - "apples"：位置 2→3；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"3","locatorHex":"303a33"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"3","locatorHex":"303a33"}
  - "application"：位置 3→4；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"4","locatorHex":"303a34"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"4","locatorHex":"303a34"}

### UV=8 / 1 本 / limit=50 / "a??"

Node 2 项，Rust API 8 项；界面字段不同；词序不同。

- Rust 多出的词（6）：["a","apple","apply","apples","abandon","application"]
- Rust 缺少的词（0）：[]
- 共同词字段变化：2 项。

  - "a-b"：位置 0→1；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"13","locatorHex":"303a3133"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"13","locatorHex":"303a3133"}
  - "app"：位置 1→2；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"6","locatorHex":"303a36"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"6","locatorHex":"303a36"}

### UV=8 / 8 本 / limit=50 / "app*"

Node 5 项，Rust API 5 项；界面字段不同；词序不同。

- Rust 多出的词（1）：["apple"]
- Rust 缺少的词（1）：["Apple"]
- 共同词字段变化：4 项。

  - "app"：位置 0→0；Node {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8],"matchKind":"wildcard","keyOrdinal":"6","locatorHex":"303a36"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8],"matchKind":"loose","keyOrdinal":"6","locatorHex":"303a36"}
  - "apply"：位置 4→2；Node {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8],"matchKind":"wildcard","keyOrdinal":"5","locatorHex":"303a35"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8],"matchKind":"prefix","keyOrdinal":"5","locatorHex":"303a35"}
  - "apples"：位置 2→3；Node {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8],"matchKind":"wildcard","keyOrdinal":"3","locatorHex":"303a33"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8],"matchKind":"prefix","keyOrdinal":"3","locatorHex":"303a33"}
  - "application"：位置 3→4；Node {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8],"matchKind":"wildcard","keyOrdinal":"4","locatorHex":"303a34"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8],"matchKind":"prefix","keyOrdinal":"4","locatorHex":"303a34"}

### UV=8 / 8 本 / limit=50 / "a??"

Node 2 项，Rust API 8 项；界面字段不同；词序不同。

- Rust 多出的词（6）：["a","apple","apply","apples","abandon","application"]
- Rust 缺少的词（0）：[]
- 共同词字段变化：2 项。

  - "a-b"：位置 0→1；Node {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8],"matchKind":"wildcard","keyOrdinal":"13","locatorHex":"303a3133"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8],"matchKind":"prefix","keyOrdinal":"13","locatorHex":"303a3133"}
  - "app"：位置 1→2；Node {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8],"matchKind":"wildcard","keyOrdinal":"6","locatorHex":"303a36"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8],"matchKind":"prefix","keyOrdinal":"6","locatorHex":"303a36"}

### UV=8 / 24 本 / limit=50 / "app*"

Node 5 项，Rust API 5 项；界面字段不同；词序不同。

- Rust 多出的词（1）：["apple"]
- Rust 缺少的词（1）：["Apple"]
- 共同词字段变化：4 项。

  - "app"：位置 0→0；Node {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"matchKind":"wildcard","keyOrdinal":"6","locatorHex":"303a36"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"matchKind":"loose","keyOrdinal":"6","locatorHex":"303a36"}
  - "apply"：位置 4→2；Node {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"matchKind":"wildcard","keyOrdinal":"5","locatorHex":"303a35"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"matchKind":"prefix","keyOrdinal":"5","locatorHex":"303a35"}
  - "apples"：位置 2→3；Node {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"matchKind":"wildcard","keyOrdinal":"3","locatorHex":"303a33"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"matchKind":"prefix","keyOrdinal":"3","locatorHex":"303a33"}
  - "application"：位置 3→4；Node {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"matchKind":"wildcard","keyOrdinal":"4","locatorHex":"303a34"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"matchKind":"prefix","keyOrdinal":"4","locatorHex":"303a34"}

### UV=8 / 24 本 / limit=50 / "a??"

Node 2 项，Rust API 8 项；界面字段不同；词序不同。

- Rust 多出的词（6）：["a","apple","apply","apples","abandon","application"]
- Rust 缺少的词（0）：[]
- 共同词字段变化：2 项。

  - "a-b"：位置 0→1；Node {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"matchKind":"wildcard","keyOrdinal":"13","locatorHex":"303a3133"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"matchKind":"prefix","keyOrdinal":"13","locatorHex":"303a3133"}
  - "app"：位置 1→2；Node {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"matchKind":"wildcard","keyOrdinal":"6","locatorHex":"303a36"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"matchKind":"prefix","keyOrdinal":"6","locatorHex":"303a36"}

## 限制与复现

- 当前 Rust API 与 Node 的 fuzzy 触发时机、全局最优距离筛选、通配符处理、每词典截断及去重范围不同，不能仅从调用次数判定等价。
- 本结果不评估修改 Rust 算法后的性能，也不包含全 Rust 索引集合、冷启动、内存、取消、多个查询同时执行、后台线程池竞争及 Electron/UI。
- 这是固定查询集和索引集合的样本，一致性比例不能推广为所有输入的通过率。原始 JSON 包含各次延迟、各轮统计、两边完整候选、差异及索引/源码/addon 哈希。

```powershell
node tests/native/didx-query-benchmark/compare-candidates.cjs '--dataset' 'tests/native/didx-query-benchmark/output/synthetic/results.json' '--output' 'tests/native/didx-query-benchmark/output/candidates-synthetic' '--rounds' '5' '--repetitions' '5' '--warmup' '2'
```
