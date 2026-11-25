# Node candidate() 与 Rust candidates() 对照

数据：real DIDX；生成时间（UTC）：2026-11-24T13:32:13.717Z；5 轮 × 每词 5 次，另预热 2 次。

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
|      4 |      1 |    50 |         10/13 |         10/13 |        1.412 |            2.330 |  0.61× |            1.425 |                2.834 |  0.50× |
|      4 |      8 |    50 |          7/13 |          7/13 |       15.322 |           35.085 |  0.44× |           20.565 |               30.983 |  0.66× |
|      4 |     20 |    50 |          8/13 |          8/13 |       30.463 |          129.934 |  0.23× |           41.410 |              130.183 |  0.32× |
|      8 |      1 |    50 |         10/13 |         10/13 |        1.516 |            2.518 |  0.60× |            1.603 |                3.080 |  0.52× |
|      8 |      8 |    50 |          7/13 |          7/13 |       16.075 |           37.093 |  0.43× |           21.860 |               32.977 |  0.66× |
|      8 |     20 |    50 |          8/13 |          8/13 |       27.939 |          124.688 |  0.22× |           37.598 |              125.623 |  0.30× |

## 逐词结果

P50/P95 单位为 ms。相同列为“完整字段 / 界面字段”。

### UV=4

| 词典数 | limit | 查询        | Node/Rust 候选数 | 相同  | Node均值 | Rust均值 |    Node P50/P95 |    Rust P50/P95 | 加速比 |
| -----: | ----: | ----------- | ---------------: | ----- | -------: | -------: | --------------: | --------------: | -----: |
|      1 |    50 | "apple"     |              8/8 | 是/是 |    0.126 |    4.368 |     0.123/0.215 |     4.260/5.782 |  0.03× |
|      1 |    50 | "hello"     |              2/2 | 是/是 |    0.089 |    4.741 |     0.083/0.140 |     4.686/6.104 |  0.02× |
|      1 |    50 | "abandon"   |              4/4 | 是/是 |    0.094 |    4.169 |     0.093/0.145 |     4.067/4.971 |  0.02× |
|      1 |    50 | "app"       |            50/50 | 是/是 |    0.371 |    0.394 |     0.352/0.515 |     0.356/0.691 |  0.94× |
|      1 |    50 | "trans"     |            50/50 | 是/是 |    0.539 |    0.483 |     0.502/0.797 |     0.407/0.967 |  1.11× |
|      1 |    50 | "a"         |            50/48 | 否/否 |    0.819 |    0.736 |     0.677/1.269 |     0.676/1.073 |  1.11× |
|      1 |    50 | "word"      |            20/20 | 是/是 |    0.204 |    1.411 |     0.153/0.399 |     1.320/2.189 |  0.14× |
|      1 |    50 | "app*"      |            50/50 | 否/否 |    0.305 |    0.407 |     0.220/0.932 |     0.312/0.706 |  0.75× |
|      1 |    50 | "a??"       |            48/48 | 否/否 |    2.990 |    0.801 |     2.706/4.485 |     0.705/1.429 |  3.73× |
|      1 |    50 | "applf"     |              2/2 | 是/是 |    4.209 |    4.401 |     3.898/5.235 |     4.212/5.709 |  0.96× |
|      1 |    50 | "helo"      |              7/7 | 是/是 |    1.313 |    1.233 |     1.203/1.835 |     1.151/1.584 |  1.06× |
|      1 |    50 | "zzqvxtest" |              0/0 | 是/是 |    6.689 |    6.561 |     6.007/9.305 |     6.012/8.693 |  1.02× |
|      1 |    50 | "中文"      |              0/0 | 是/是 |    0.613 |    0.579 |     0.597/0.886 |     0.530/0.821 |  1.06× |
|      8 |    50 | "apple"     |            35/37 | 否/否 |    0.403 |   59.034 |     0.374/0.671 |   58.115/76.713 |  0.01× |
|      8 |    50 | "hello"     |            14/17 | 否/否 |    0.269 |   65.573 |     0.217/0.460 |   60.713/86.646 |  0.00× |
|      8 |    50 | "abandon"   |            28/30 | 否/否 |    0.338 |   63.498 |     0.329/0.496 |   62.683/73.182 |  0.01× |
|      8 |    50 | "app"       |            50/50 | 是/是 |    1.627 |   13.730 |     1.521/2.054 |   13.127/17.684 |  0.12× |
|      8 |    50 | "trans"     |            50/50 | 是/是 |    1.662 |   14.943 |     1.593/2.322 |   14.254/18.366 |  0.11× |
|      8 |    50 | "a"         |            50/50 | 是/是 |    2.927 |   14.402 |     2.582/4.627 |   12.918/20.785 |  0.20× |
|      8 |    50 | "word"      |            50/50 | 是/是 |    1.310 |   25.699 |     1.209/1.905 |   24.250/31.908 |  0.05× |
|      8 |    50 | "app*"      |            50/50 | 否/否 |    1.051 |   13.588 |     1.004/1.482 |   12.497/18.279 |  0.08× |
|      8 |    50 | "a??"       |            50/50 | 否/否 |   53.011 |   13.510 |   51.963/61.382 |   13.165/15.448 |  3.92× |
|      8 |    50 | "applf"     |              2/2 | 是/是 |   61.515 |   61.387 |   60.477/73.750 |   59.464/70.328 |  1.00× |
|      8 |    50 | "helo"      |            50/50 | 是/是 |    0.899 |   14.696 |     0.859/1.372 |   14.392/18.245 |  0.06× |
|      8 |    50 | "zzqvxtest" |              0/0 | 是/是 |   74.018 |   72.022 |   71.864/82.542 |   71.044/79.922 |  1.03× |
|      8 |    50 | "中文"      |             2/25 | 否/否 |    0.158 |   24.026 |     0.133/0.297 |   23.971/27.103 |  0.01× |
|     20 |    50 | "apple"     |            50/50 | 是/是 |    1.521 |  145.203 |     1.442/1.874 | 145.088/162.309 |  0.01× |
|     20 |    50 | "hello"     |            33/36 | 否/否 |    0.653 |  151.998 |     0.587/1.132 | 153.005/174.514 |  0.00× |
|     20 |    50 | "abandon"   |            47/49 | 否/否 |    0.819 |  148.026 |     0.771/1.094 | 147.925/162.535 |  0.01× |
|     20 |    50 | "app"       |            50/50 | 是/是 |    3.524 |  110.374 |     3.432/4.621 | 108.212/122.744 |  0.03× |
|     20 |    50 | "trans"     |            50/50 | 是/是 |    4.244 |  119.314 |     4.161/5.169 | 119.352/133.945 |  0.04× |
|     20 |    50 | "a"         |            50/50 | 是/是 |    4.766 |  111.345 |     4.598/6.432 | 110.763/126.284 |  0.04× |
|     20 |    50 | "word"      |            50/50 | 是/是 |    2.444 |  121.158 |     2.347/3.146 | 121.950/137.767 |  0.02× |
|     20 |    50 | "app*"      |            50/50 | 否/否 |    2.326 |  114.380 |     2.330/3.050 | 112.954/129.603 |  0.02× |
|     20 |    50 | "a??"       |            50/50 | 否/否 |   60.493 |  110.902 |   61.172/70.389 | 111.067/129.407 |  0.55× |
|     20 |    50 | "applf"     |              3/3 | 是/是 |  150.131 |  150.932 | 151.682/159.389 | 151.416/175.122 |  0.99× |
|     20 |    50 | "helo"      |            50/50 | 是/是 |    1.008 |  118.638 |     0.926/1.535 | 118.929/128.221 |  0.01× |
|     20 |    50 | "zzqvxtest" |              0/0 | 是/是 |  163.645 |  164.496 | 164.126/180.024 | 166.169/183.425 |  0.99× |
|     20 |    50 | "中文"      |             2/50 | 否/否 |    0.450 |  122.375 |     0.374/0.994 | 123.662/138.029 |  0.00× |

### UV=8

| 词典数 | limit | 查询        | Node/Rust 候选数 | 相同  | Node均值 | Rust均值 |    Node P50/P95 |    Rust P50/P95 | 加速比 |
| -----: | ----: | ----------- | ---------------: | ----- | -------: | -------: | --------------: | --------------: | -----: |
|      1 |    50 | "apple"     |              8/8 | 是/是 |    0.118 |    4.755 |     0.117/0.164 |     4.265/8.130 |  0.02× |
|      1 |    50 | "hello"     |              2/2 | 是/是 |    0.097 |    4.742 |     0.081/0.162 |     4.495/6.106 |  0.02× |
|      1 |    50 | "abandon"   |              4/4 | 是/是 |    0.111 |    4.415 |     0.085/0.216 |     4.194/5.071 |  0.03× |
|      1 |    50 | "app"       |            50/50 | 是/是 |    0.485 |    0.463 |     0.379/0.882 |     0.374/0.730 |  1.05× |
|      1 |    50 | "trans"     |            50/50 | 是/是 |    0.613 |    0.499 |     0.496/1.036 |     0.473/0.779 |  1.23× |
|      1 |    50 | "a"         |            50/48 | 否/否 |    0.757 |    0.772 |     0.692/1.103 |     0.666/1.125 |  0.98× |
|      1 |    50 | "word"      |            20/20 | 是/是 |    0.169 |    1.405 |     0.161/0.251 |     1.366/1.721 |  0.12× |
|      1 |    50 | "app*"      |            50/50 | 否/否 |    0.240 |    0.399 |     0.233/0.331 |     0.376/0.576 |  0.60× |
|      1 |    50 | "a??"       |            48/48 | 否/否 |    2.678 |    0.768 |     2.464/5.449 |     0.722/1.079 |  3.49× |
|      1 |    50 | "applf"     |              2/2 | 是/是 |    4.799 |    5.018 |     4.261/6.735 |     4.271/8.569 |  0.96× |
|      1 |    50 | "helo"      |              7/7 | 是/是 |    1.736 |    1.674 |     1.502/3.113 |     1.254/2.963 |  1.04× |
|      1 |    50 | "zzqvxtest" |              0/0 | 是/是 |    7.229 |    7.238 |    6.294/10.941 |    6.476/10.232 |  1.00× |
|      1 |    50 | "中文"      |              0/0 | 是/是 |    0.675 |    0.587 |     0.623/0.992 |     0.531/0.988 |  1.15× |
|      8 |    50 | "apple"     |            35/37 | 否/否 |    0.498 |   63.257 |     0.481/0.845 |   63.014/69.361 |  0.01× |
|      8 |    50 | "hello"     |            14/17 | 否/否 |    0.308 |   65.625 |     0.291/0.449 |   63.971/74.266 |  0.00× |
|      8 |    50 | "abandon"   |            28/30 | 否/否 |    0.492 |   68.822 |     0.477/0.707 |   66.100/84.390 |  0.01× |
|      8 |    50 | "app"       |            50/50 | 是/是 |    1.666 |   15.786 |     1.594/2.395 |   14.994/22.121 |  0.11× |
|      8 |    50 | "trans"     |            50/50 | 是/是 |    1.773 |   16.262 |     1.736/2.273 |   15.193/20.417 |  0.11× |
|      8 |    50 | "a"         |            50/50 | 是/是 |    2.814 |   13.844 |     2.751/3.737 |   13.103/18.298 |  0.20× |
|      8 |    50 | "word"      |            50/50 | 是/是 |    1.409 |   26.966 |     1.373/1.933 |   27.123/31.653 |  0.05× |
|      8 |    50 | "app*"      |            50/50 | 否/否 |    1.024 |   13.327 |     0.938/1.601 |   13.073/15.284 |  0.08× |
|      8 |    50 | "a??"       |            50/50 | 否/否 |   53.407 |   13.354 |   52.809/60.946 |   13.105/14.896 |  4.00× |
|      8 |    50 | "applf"     |              2/2 | 是/是 |   61.929 |   62.737 |   62.112/68.934 |   62.756/67.341 |  0.99× |
|      8 |    50 | "helo"      |            50/50 | 是/是 |    0.870 |   14.551 |     0.849/1.047 |   13.865/17.807 |  0.06× |
|      8 |    50 | "zzqvxtest" |              0/0 | 是/是 |   82.558 |   80.693 |   82.152/94.084 |   79.599/91.926 |  1.02× |
|      8 |    50 | "中文"      |             2/25 | 否/否 |    0.222 |   26.989 |     0.190/0.372 |   26.737/31.772 |  0.01× |
|     20 |    50 | "apple"     |            50/50 | 是/是 |    1.749 |  133.623 |     1.550/2.807 | 133.450/145.777 |  0.01× |
|     20 |    50 | "hello"     |            33/36 | 否/否 |    0.961 |  137.383 |     0.864/1.635 | 137.779/147.723 |  0.01× |
|     20 |    50 | "abandon"   |            47/49 | 否/否 |    1.234 |  140.415 |     1.194/1.851 | 141.865/151.534 |  0.01× |
|     20 |    50 | "app"       |            50/50 | 是/是 |    3.989 |  114.661 |     3.900/4.964 | 113.817/125.608 |  0.03× |
|     20 |    50 | "trans"     |            50/50 | 是/是 |    4.573 |  119.780 |     4.246/6.181 | 118.920/135.805 |  0.04× |
|     20 |    50 | "a"         |            50/50 | 是/是 |    4.382 |  109.142 |     4.220/5.365 | 107.954/120.230 |  0.04× |
|     20 |    50 | "word"      |            50/50 | 是/是 |    2.873 |  115.849 |     2.874/3.891 | 114.686/130.714 |  0.02× |
|     20 |    50 | "app*"      |            50/50 | 否/否 |    2.419 |  112.095 |     2.202/3.672 | 111.670/117.796 |  0.02× |
|     20 |    50 | "a??"       |            50/50 | 否/否 |   57.138 |  110.417 |   55.743/65.749 | 110.177/117.274 |  0.52× |
|     20 |    50 | "applf"     |              3/3 | 是/是 |  133.318 |  139.488 | 132.741/142.787 | 138.791/153.245 |  0.96× |
|     20 |    50 | "helo"      |            50/50 | 是/是 |    1.119 |  119.758 |     1.009/1.582 | 118.076/139.408 |  0.01× |
|     20 |    50 | "zzqvxtest" |              0/0 | 是/是 |  148.785 |  152.684 | 148.857/169.576 | 154.003/168.065 |  0.97× |
|     20 |    50 | "中文"      |             2/50 | 否/否 |    0.672 |  115.652 |     0.631/1.143 | 114.361/131.334 |  0.01× |

## 差异明细

每项只展示前 10 个增删词和前 5 个共同词的字段变化；完整输出、locator、排序与差异均保存在 results.json。

### UV=4 / 1 本 / limit=50 / "a"

Node 50 项，Rust API 48 项；界面字段不同；词序不同。

- Rust 多出的词（0）：[]
- Rust 缺少的词（2）：["absent","absorb"]
- 共同词字段变化：0 项。

### UV=4 / 1 本 / limit=50 / "app*"

Node 50 项，Rust API 50 项；界面字段不同；词序不同。

- Rust 多出的词（21）：["apply","applied","appoint","apprise","approve","approx.","appliqué","apposite","appraise","approach"]
- Rust 缺少的词（21）：["appallingly","apparatchik","Appeal Court","appeal [go] to arms","appealingly","appearance","appeasement","appellate court","appellation","appendectomy"]
- 共同词字段变化：29 项。

  - "appal"：位置 0→0；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"2222","locatorHex":"e5db5e8202"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"2222","locatorHex":"e5db5e8202"}
  - "apple"：位置 41→1；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"2265","locatorHex":"889761e011"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"2265","locatorHex":"889761e011"}
  - "appall"：位置 1→3；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"2223","locatorHex":"e7dd5ee002"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"2223","locatorHex":"e7dd5ee002"}
  - "appeal"：位置 11→4；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"2233","locatorHex":"8ba35fff31"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"2233","locatorHex":"8ba35fff31"}
  - "appear"：位置 16→5；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"2238","locatorHex":"c7e15fc72c"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"2238","locatorHex":"c7e15fc72c"}

### UV=4 / 1 本 / limit=50 / "a??"

Node 48 项，Rust API 48 项；界面字段不同；词序不同。

- Rust 多出的词（43）：["A","A.","a-","AB","ac","a, A","abbé","abbr","abed","Abel"]
- Rust 缺少的词（43）：["A.A","A.B","ab-","a.c","a/c","ace","ACT","a.d","ad.","ADB"]
- 共同词字段变化：5 项。

  - "A 1"：位置 0→5；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"15","locatorHex":"dd9e0114"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"15","locatorHex":"dd9e0114"}
  - "AAA"：位置 2→6；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"20","locatorHex":"e2b7019303"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"20","locatorHex":"e2b7019303"}
  - "ABC"：位置 5→7；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"64","locatorHex":"9cb202bb09"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"64","locatorHex":"9cb202bb09"}
  - "ABM"：位置 6→8；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"124","locatorHex":"bf9704ec01"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"124","locatorHex":"bf9704ec01"}
  - "ABS"：位置 7→9；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"194","locatorHex":"e9ce07fb01"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"194","locatorHex":"e9ce07fb01"}

### UV=4 / 8 本 / limit=50 / "apple"

Node 35 项，Rust API 37 项；界面字段不同；词序不同。

- Rust 多出的词（2）：["apply","ample"]
- Rust 缺少的词（0）：[]
- 共同词字段变化：0 项。

### UV=4 / 8 本 / limit=50 / "hello"

Node 14 项，Rust API 17 项；界面字段不同；词序不同。

- Rust 多出的词（3）：["helle","helluo","heluo"]
- Rust 缺少的词（0）：[]
- 共同词字段变化：0 项。

### UV=4 / 8 本 / limit=50 / "abandon"

Node 28 项，Rust API 30 项；界面字段不同；词序不同。

- Rust 多出的词（2）：["awandan","andon"]
- Rust 缺少的词（0）：[]
- 共同词字段变化：0 项。

### UV=4 / 8 本 / limit=50 / "app*"

Node 50 项，Rust API 50 项；界面字段不同；词序不同。

- Rust 多出的词（42）：["appaz","appia","Apple","apply","appeal","appear","append","appian","Appias","apples"]
- Rust 缺少的词（42）：["appalachia","appalachian","appalachian-dulcimer","appalachian-mountains","appalachians","appalachians, the","appalachiensis","appalling","appalling-lack","appallingly"]
- 共同词字段变化：8 项。

  - "app"：位置 0→0；Node {"dictionaryId":5,"dictionaryIds":[5,6,8],"matchKind":"wildcard","keyOrdinal":"6865","locatorHex":"97b0fe4dbdb302"}；Rust API {"dictionaryId":5,"dictionaryIds":[5,6,8],"matchKind":"loose","keyOrdinal":"6865","locatorHex":"97b0fe4dbdb302"}
  - "appal"：位置 1→1；Node {"dictionaryId":1,"dictionaryIds":[1,3,5,6],"matchKind":"wildcard","keyOrdinal":"2222","locatorHex":"e5db5e8202"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,3,5,6],"matchKind":"prefix","keyOrdinal":"2222","locatorHex":"e5db5e8202"}
  - "appall"：位置 9→6；Node {"dictionaryId":1,"dictionaryIds":[1,5,6,8],"matchKind":"wildcard","keyOrdinal":"2223","locatorHex":"e7dd5ee002"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,5,6,8],"matchKind":"prefix","keyOrdinal":"2223","locatorHex":"e7dd5ee002"}
  - "appals"：位置 18→7；Node {"dictionaryId":6,"dictionaryIds":[6],"matchKind":"wildcard","keyOrdinal":"7521","locatorHex":"dadfb50a10"}；Rust API {"dictionaryId":6,"dictionaryIds":[6],"matchKind":"prefix","keyOrdinal":"7521","locatorHex":"dadfb50a10"}
  - "apparel"：位置 24→16；Node {"dictionaryId":1,"dictionaryIds":[1,3,5,6,8],"matchKind":"wildcard","keyOrdinal":"2229","locatorHex":"dbf55eb20a"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,3,5,6,8],"matchKind":"prefix","keyOrdinal":"2229","locatorHex":"dbf55eb20a"}

### UV=4 / 8 本 / limit=50 / "a??"

Node 50 项，Rust API 50 项；界面字段不同；词序不同。

- Rust 多出的词（26）：["A","A.","a*","a-","à","á","ā","A1","A2","A3"]
- Rust 缺少的词（26）：["A41","A42","A43","A50","A51","A52","A53","A54","A55","A56"]
- 共同词字段变化：24 项。

  - "A 1"：位置 0→26；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"15","locatorHex":"dd9e0114"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"15","locatorHex":"dd9e0114"}
  - "a-1"：位置 1→27；Node {"dictionaryId":6,"dictionaryIds":[6],"matchKind":"wildcard","keyOrdinal":"2722","locatorHex":"b8e75ea50d"}；Rust API {"dictionaryId":6,"dictionaryIds":[6],"matchKind":"prefix","keyOrdinal":"2722","locatorHex":"b8e75ea50d"}
  - "A10"：位置 2→28；Node {"dictionaryId":3,"dictionaryIds":[3],"matchKind":"wildcard","keyOrdinal":"6","locatorHex":"e2be01f017"}；Rust API {"dictionaryId":3,"dictionaryIds":[3],"matchKind":"prefix","keyOrdinal":"6","locatorHex":"e2be01f017"}
  - "A11"：位置 3→29；Node {"dictionaryId":3,"dictionaryIds":[3],"matchKind":"wildcard","keyOrdinal":"12","locatorHex":"b7fe029a39"}；Rust API {"dictionaryId":3,"dictionaryIds":[3],"matchKind":"prefix","keyOrdinal":"12","locatorHex":"b7fe029a39"}
  - "A12"：位置 4→30；Node {"dictionaryId":3,"dictionaryIds":[3],"matchKind":"wildcard","keyOrdinal":"17","locatorHex":"b4e504b91f"}；Rust API {"dictionaryId":3,"dictionaryIds":[3],"matchKind":"prefix","keyOrdinal":"17","locatorHex":"b4e504b91f"}

### UV=4 / 8 本 / limit=50 / "中文"

Node 2 项，Rust API 25 项；界面字段不同；词序不同。

- Rust 多出的词（23）：["中人","中令","中使","中兴","中分","中国","中官","中尉","中岳","中州"]
- Rust 缺少的词（0）：[]
- 共同词字段变化：0 项。

### UV=4 / 20 本 / limit=50 / "hello"

Node 33 项，Rust API 36 项；界面字段不同；词序不同。

- Rust 多出的词（3）：["helle","helluo","heluo"]
- Rust 缺少的词（0）：[]
- 共同词字段变化：0 项。

### UV=4 / 20 本 / limit=50 / "abandon"

Node 47 项，Rust API 49 项；界面字段不同；词序不同。

- Rust 多出的词（2）：["awandan","andon"]
- Rust 缺少的词（0）：[]
- 共同词字段变化：0 项。

### UV=4 / 20 本 / limit=50 / "app*"

Node 50 项，Rust API 50 项；界面字段不同；词序不同。

- Rust 多出的词（41）：["Apps","appaz","Appel","appia","appl.","Apple","apply","appeal","appear","Appell"]
- Rust 缺少的词（41）：["Appalachia","Appalachiae","Appalachian","Appalachian Bible College","Appalachian dulcimer","Appalachian-dulcimer","Appalachiandulcimer","Appalachian Mountains","Appalachian-Mountains","AppalachianMountains"]
- 共同词字段变化：9 项。

  - "APP"：位置 0→0；Node {"dictionaryId":19,"dictionaryIds":[19,14,5,6,8,9,12,13,17,18],"matchKind":"wildcard","keyOrdinal":"8895","locatorHex":"aba697040c"}；Rust API {"dictionaryId":19,"dictionaryIds":[19,14,5,6,8,9,12,13,17,18],"matchKind":"loose","keyOrdinal":"8895","locatorHex":"aba697040c"}
  - "app."：位置 1→1；Node {"dictionaryId":14,"dictionaryIds":[14,19],"matchKind":"wildcard","keyOrdinal":"5182","locatorHex":"eada8007ef19"}；Rust API {"dictionaryId":14,"dictionaryIds":[14,19],"matchKind":"loose","keyOrdinal":"5182","locatorHex":"eada8007ef19"}
  - "appa"：位置 2→2；Node {"dictionaryId":9,"dictionaryIds":[9,18],"matchKind":"wildcard","keyOrdinal":"4109","locatorHex":"c7b2c505e414"}；Rust API {"dictionaryId":9,"dictionaryIds":[9,18],"matchKind":"prefix","keyOrdinal":"4109","locatorHex":"c7b2c505e414"}
  - "appal"：位置 3→4；Node {"dictionaryId":1,"dictionaryIds":[1,3,5,6,9,12,13,18,19],"matchKind":"wildcard","keyOrdinal":"2222","locatorHex":"e5db5e8202"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,3,5,6,9,12,13,18,19],"matchKind":"prefix","keyOrdinal":"2222","locatorHex":"e5db5e8202"}
  - "appam"：位置 40→5；Node {"dictionaryId":13,"dictionaryIds":[13],"matchKind":"wildcard","keyOrdinal":"25435","locatorHex":"b784e41edf0e"}；Rust API {"dictionaryId":13,"dictionaryIds":[13],"matchKind":"prefix","keyOrdinal":"25435","locatorHex":"b784e41edf0e"}

### UV=4 / 20 本 / limit=50 / "a??"

Node 50 项，Rust API 50 项；界面字段不同；词序不同。

- Rust 多出的词（35）：["'a","'a'","-a","A","A*","A.","a'","a-","Å","à"]
- Rust 缺少的词（35）：["a_1","A1s","A1酱","A-2","a_2","A20","A2P","A-3","a_3","A30"]
- 共同词字段变化：15 项。

  - "a**"：位置 0→7；Node {"dictionaryId":14,"dictionaryIds":[14],"matchKind":"wildcard","keyOrdinal":"803","locatorHex":"b9915dfc14"}；Rust API {"dictionaryId":14,"dictionaryIds":[14],"matchKind":"loose","keyOrdinal":"803","locatorHex":"b9915dfc14"}
  - "A++"：位置 1→36；Node {"dictionaryId":14,"dictionaryIds":[14],"matchKind":"wildcard","keyOrdinal":"805","locatorHex":"93da5dbd10"}；Rust API {"dictionaryId":14,"dictionaryIds":[14],"matchKind":"prefix","keyOrdinal":"805","locatorHex":"93da5dbd10"}
  - "A 1"：位置 2→37；Node {"dictionaryId":1,"dictionaryIds":[1,12],"matchKind":"wildcard","keyOrdinal":"15","locatorHex":"dd9e0114"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,12],"matchKind":"prefix","keyOrdinal":"15","locatorHex":"dd9e0114"}
  - "A-1"：位置 3→38；Node {"dictionaryId":12,"dictionaryIds":[12,14,19,6],"matchKind":"wildcard","keyOrdinal":"169","locatorHex":"85d012f020"}；Rust API {"dictionaryId":14,"dictionaryIds":[14,19,6],"matchKind":"prefix","keyOrdinal":"808","locatorHex":"c79463bb22"}
  - "A10"：位置 5→39；Node {"dictionaryId":3,"dictionaryIds":[3],"matchKind":"wildcard","keyOrdinal":"6","locatorHex":"e2be01f017"}；Rust API {"dictionaryId":3,"dictionaryIds":[3],"matchKind":"prefix","keyOrdinal":"6","locatorHex":"e2be01f017"}

### UV=4 / 20 本 / limit=50 / "中文"

Node 2 项，Rust API 50 项；界面字段不同；词序不同。

- Rust 多出的词（48）：["中专","中东","中丞","中乂","中书","中云","中亚","中京","中人","中介"]
- Rust 缺少的词（0）：[]
- 共同词字段变化：0 项。

### UV=8 / 1 本 / limit=50 / "a"

Node 50 项，Rust API 48 项；界面字段不同；词序不同。

- Rust 多出的词（0）：[]
- Rust 缺少的词（2）：["absent","absorb"]
- 共同词字段变化：0 项。

### UV=8 / 1 本 / limit=50 / "app*"

Node 50 项，Rust API 50 项；界面字段不同；词序不同。

- Rust 多出的词（21）：["apply","applied","appoint","apprise","approve","approx.","appliqué","apposite","appraise","approach"]
- Rust 缺少的词（21）：["appallingly","apparatchik","Appeal Court","appeal [go] to arms","appealingly","appearance","appeasement","appellate court","appellation","appendectomy"]
- 共同词字段变化：29 项。

  - "appal"：位置 0→0；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"2222","locatorHex":"e5db5e8202"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"2222","locatorHex":"e5db5e8202"}
  - "apple"：位置 41→1；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"2265","locatorHex":"889761e011"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"2265","locatorHex":"889761e011"}
  - "appall"：位置 1→3；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"2223","locatorHex":"e7dd5ee002"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"2223","locatorHex":"e7dd5ee002"}
  - "appeal"：位置 11→4；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"2233","locatorHex":"8ba35fff31"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"2233","locatorHex":"8ba35fff31"}
  - "appear"：位置 16→5；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"2238","locatorHex":"c7e15fc72c"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"2238","locatorHex":"c7e15fc72c"}

### UV=8 / 1 本 / limit=50 / "a??"

Node 48 项，Rust API 48 项；界面字段不同；词序不同。

- Rust 多出的词（43）：["A","A.","a-","AB","ac","a, A","abbé","abbr","abed","Abel"]
- Rust 缺少的词（43）：["A.A","A.B","ab-","a.c","a/c","ace","ACT","a.d","ad.","ADB"]
- 共同词字段变化：5 项。

  - "A 1"：位置 0→5；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"15","locatorHex":"dd9e0114"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"15","locatorHex":"dd9e0114"}
  - "AAA"：位置 2→6；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"20","locatorHex":"e2b7019303"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"20","locatorHex":"e2b7019303"}
  - "ABC"：位置 5→7；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"64","locatorHex":"9cb202bb09"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"64","locatorHex":"9cb202bb09"}
  - "ABM"：位置 6→8；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"124","locatorHex":"bf9704ec01"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"124","locatorHex":"bf9704ec01"}
  - "ABS"：位置 7→9；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"194","locatorHex":"e9ce07fb01"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"194","locatorHex":"e9ce07fb01"}

### UV=8 / 8 本 / limit=50 / "apple"

Node 35 项，Rust API 37 项；界面字段不同；词序不同。

- Rust 多出的词（2）：["apply","ample"]
- Rust 缺少的词（0）：[]
- 共同词字段变化：0 项。

### UV=8 / 8 本 / limit=50 / "hello"

Node 14 项，Rust API 17 项；界面字段不同；词序不同。

- Rust 多出的词（3）：["helle","helluo","heluo"]
- Rust 缺少的词（0）：[]
- 共同词字段变化：0 项。

### UV=8 / 8 本 / limit=50 / "abandon"

Node 28 项，Rust API 30 项；界面字段不同；词序不同。

- Rust 多出的词（2）：["awandan","andon"]
- Rust 缺少的词（0）：[]
- 共同词字段变化：0 项。

### UV=8 / 8 本 / limit=50 / "app*"

Node 50 项，Rust API 50 项；界面字段不同；词序不同。

- Rust 多出的词（42）：["appaz","appia","Apple","apply","appeal","appear","append","appian","Appias","apples"]
- Rust 缺少的词（42）：["appalachia","appalachian","appalachian-dulcimer","appalachian-mountains","appalachians","appalachians, the","appalachiensis","appalling","appalling-lack","appallingly"]
- 共同词字段变化：8 项。

  - "app"：位置 0→0；Node {"dictionaryId":5,"dictionaryIds":[5,6,8],"matchKind":"wildcard","keyOrdinal":"6865","locatorHex":"97b0fe4dbdb302"}；Rust API {"dictionaryId":5,"dictionaryIds":[5,6,8],"matchKind":"loose","keyOrdinal":"6865","locatorHex":"97b0fe4dbdb302"}
  - "appal"：位置 1→1；Node {"dictionaryId":1,"dictionaryIds":[1,3,5,6],"matchKind":"wildcard","keyOrdinal":"2222","locatorHex":"e5db5e8202"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,3,5,6],"matchKind":"prefix","keyOrdinal":"2222","locatorHex":"e5db5e8202"}
  - "appall"：位置 9→6；Node {"dictionaryId":1,"dictionaryIds":[1,5,6,8],"matchKind":"wildcard","keyOrdinal":"2223","locatorHex":"e7dd5ee002"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,5,6,8],"matchKind":"prefix","keyOrdinal":"2223","locatorHex":"e7dd5ee002"}
  - "appals"：位置 18→7；Node {"dictionaryId":6,"dictionaryIds":[6],"matchKind":"wildcard","keyOrdinal":"7521","locatorHex":"dadfb50a10"}；Rust API {"dictionaryId":6,"dictionaryIds":[6],"matchKind":"prefix","keyOrdinal":"7521","locatorHex":"dadfb50a10"}
  - "apparel"：位置 24→16；Node {"dictionaryId":1,"dictionaryIds":[1,3,5,6,8],"matchKind":"wildcard","keyOrdinal":"2229","locatorHex":"dbf55eb20a"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,3,5,6,8],"matchKind":"prefix","keyOrdinal":"2229","locatorHex":"dbf55eb20a"}

### UV=8 / 8 本 / limit=50 / "a??"

Node 50 项，Rust API 50 项；界面字段不同；词序不同。

- Rust 多出的词（26）：["A","A.","a*","a-","à","á","ā","A1","A2","A3"]
- Rust 缺少的词（26）：["A41","A42","A43","A50","A51","A52","A53","A54","A55","A56"]
- 共同词字段变化：24 项。

  - "A 1"：位置 0→26；Node {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"wildcard","keyOrdinal":"15","locatorHex":"dd9e0114"}；Rust API {"dictionaryId":1,"dictionaryIds":[1],"matchKind":"prefix","keyOrdinal":"15","locatorHex":"dd9e0114"}
  - "a-1"：位置 1→27；Node {"dictionaryId":6,"dictionaryIds":[6],"matchKind":"wildcard","keyOrdinal":"2722","locatorHex":"b8e75ea50d"}；Rust API {"dictionaryId":6,"dictionaryIds":[6],"matchKind":"prefix","keyOrdinal":"2722","locatorHex":"b8e75ea50d"}
  - "A10"：位置 2→28；Node {"dictionaryId":3,"dictionaryIds":[3],"matchKind":"wildcard","keyOrdinal":"6","locatorHex":"e2be01f017"}；Rust API {"dictionaryId":3,"dictionaryIds":[3],"matchKind":"prefix","keyOrdinal":"6","locatorHex":"e2be01f017"}
  - "A11"：位置 3→29；Node {"dictionaryId":3,"dictionaryIds":[3],"matchKind":"wildcard","keyOrdinal":"12","locatorHex":"b7fe029a39"}；Rust API {"dictionaryId":3,"dictionaryIds":[3],"matchKind":"prefix","keyOrdinal":"12","locatorHex":"b7fe029a39"}
  - "A12"：位置 4→30；Node {"dictionaryId":3,"dictionaryIds":[3],"matchKind":"wildcard","keyOrdinal":"17","locatorHex":"b4e504b91f"}；Rust API {"dictionaryId":3,"dictionaryIds":[3],"matchKind":"prefix","keyOrdinal":"17","locatorHex":"b4e504b91f"}

### UV=8 / 8 本 / limit=50 / "中文"

Node 2 项，Rust API 25 项；界面字段不同；词序不同。

- Rust 多出的词（23）：["中人","中令","中使","中兴","中分","中国","中官","中尉","中岳","中州"]
- Rust 缺少的词（0）：[]
- 共同词字段变化：0 项。

### UV=8 / 20 本 / limit=50 / "hello"

Node 33 项，Rust API 36 项；界面字段不同；词序不同。

- Rust 多出的词（3）：["helle","helluo","heluo"]
- Rust 缺少的词（0）：[]
- 共同词字段变化：0 项。

### UV=8 / 20 本 / limit=50 / "abandon"

Node 47 项，Rust API 49 项；界面字段不同；词序不同。

- Rust 多出的词（2）：["awandan","andon"]
- Rust 缺少的词（0）：[]
- 共同词字段变化：0 项。

### UV=8 / 20 本 / limit=50 / "app*"

Node 50 项，Rust API 50 项；界面字段不同；词序不同。

- Rust 多出的词（41）：["Apps","appaz","Appel","appia","appl.","Apple","apply","appeal","appear","Appell"]
- Rust 缺少的词（41）：["Appalachia","Appalachiae","Appalachian","Appalachian Bible College","Appalachian dulcimer","Appalachian-dulcimer","Appalachiandulcimer","Appalachian Mountains","Appalachian-Mountains","AppalachianMountains"]
- 共同词字段变化：9 项。

  - "APP"：位置 0→0；Node {"dictionaryId":19,"dictionaryIds":[19,14,5,6,8,9,12,13,17,18],"matchKind":"wildcard","keyOrdinal":"8895","locatorHex":"aba697040c"}；Rust API {"dictionaryId":19,"dictionaryIds":[19,14,5,6,8,9,12,13,17,18],"matchKind":"loose","keyOrdinal":"8895","locatorHex":"aba697040c"}
  - "app."：位置 1→1；Node {"dictionaryId":14,"dictionaryIds":[14,19],"matchKind":"wildcard","keyOrdinal":"5182","locatorHex":"eada8007ef19"}；Rust API {"dictionaryId":14,"dictionaryIds":[14,19],"matchKind":"loose","keyOrdinal":"5182","locatorHex":"eada8007ef19"}
  - "appa"：位置 2→2；Node {"dictionaryId":9,"dictionaryIds":[9,18],"matchKind":"wildcard","keyOrdinal":"4109","locatorHex":"c7b2c505e414"}；Rust API {"dictionaryId":9,"dictionaryIds":[9,18],"matchKind":"prefix","keyOrdinal":"4109","locatorHex":"c7b2c505e414"}
  - "appal"：位置 3→4；Node {"dictionaryId":1,"dictionaryIds":[1,3,5,6,9,12,13,18,19],"matchKind":"wildcard","keyOrdinal":"2222","locatorHex":"e5db5e8202"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,3,5,6,9,12,13,18,19],"matchKind":"prefix","keyOrdinal":"2222","locatorHex":"e5db5e8202"}
  - "appam"：位置 40→5；Node {"dictionaryId":13,"dictionaryIds":[13],"matchKind":"wildcard","keyOrdinal":"25435","locatorHex":"b784e41edf0e"}；Rust API {"dictionaryId":13,"dictionaryIds":[13],"matchKind":"prefix","keyOrdinal":"25435","locatorHex":"b784e41edf0e"}

### UV=8 / 20 本 / limit=50 / "a??"

Node 50 项，Rust API 50 项；界面字段不同；词序不同。

- Rust 多出的词（35）：["'a","'a'","-a","A","A*","A.","a'","a-","Å","à"]
- Rust 缺少的词（35）：["a_1","A1s","A1酱","A-2","a_2","A20","A2P","A-3","a_3","A30"]
- 共同词字段变化：15 项。

  - "a**"：位置 0→7；Node {"dictionaryId":14,"dictionaryIds":[14],"matchKind":"wildcard","keyOrdinal":"803","locatorHex":"b9915dfc14"}；Rust API {"dictionaryId":14,"dictionaryIds":[14],"matchKind":"loose","keyOrdinal":"803","locatorHex":"b9915dfc14"}
  - "A++"：位置 1→36；Node {"dictionaryId":14,"dictionaryIds":[14],"matchKind":"wildcard","keyOrdinal":"805","locatorHex":"93da5dbd10"}；Rust API {"dictionaryId":14,"dictionaryIds":[14],"matchKind":"prefix","keyOrdinal":"805","locatorHex":"93da5dbd10"}
  - "A 1"：位置 2→37；Node {"dictionaryId":1,"dictionaryIds":[1,12],"matchKind":"wildcard","keyOrdinal":"15","locatorHex":"dd9e0114"}；Rust API {"dictionaryId":1,"dictionaryIds":[1,12],"matchKind":"prefix","keyOrdinal":"15","locatorHex":"dd9e0114"}
  - "A-1"：位置 3→38；Node {"dictionaryId":12,"dictionaryIds":[12,14,19,6],"matchKind":"wildcard","keyOrdinal":"169","locatorHex":"85d012f020"}；Rust API {"dictionaryId":14,"dictionaryIds":[14,19,6],"matchKind":"prefix","keyOrdinal":"808","locatorHex":"c79463bb22"}
  - "A10"：位置 5→39；Node {"dictionaryId":3,"dictionaryIds":[3],"matchKind":"wildcard","keyOrdinal":"6","locatorHex":"e2be01f017"}；Rust API {"dictionaryId":3,"dictionaryIds":[3],"matchKind":"prefix","keyOrdinal":"6","locatorHex":"e2be01f017"}

### UV=8 / 20 本 / limit=50 / "中文"

Node 2 项，Rust API 50 项；界面字段不同；词序不同。

- Rust 多出的词（48）：["中专","中东","中丞","中乂","中书","中云","中亚","中京","中人","中介"]
- Rust 缺少的词（0）：[]
- 共同词字段变化：0 项。

## 限制与复现

- 当前 Rust API 与 Node 的 fuzzy 触发时机、全局最优距离筛选、通配符处理、每词典截断及去重范围不同，不能仅从调用次数判定等价。
- 本结果不评估修改 Rust 算法后的性能，也不包含全 Rust 索引集合、冷启动、内存、取消、多个查询同时执行、后台线程池竞争及 Electron/UI。
- 这是固定查询集和索引集合的样本，一致性比例不能推广为所有输入的通过率。原始 JSON 包含各次延迟、各轮统计、两边完整候选、差异及索引/源码/addon 哈希。

```powershell
node tests/native/didx-query-benchmark/compare-candidates.cjs '--dataset' 'tests/native/didx-query-benchmark/output/real/results.json' '--output' 'tests/native/didx-query-benchmark/output/candidates-real' '--rounds' '5' '--repetitions' '5' '--warmup' '2'
```
