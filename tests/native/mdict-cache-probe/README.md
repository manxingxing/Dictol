# MDX 缓存容量诊断

只读打开指定 MDX，在独立 Rust 进程中填充原生库当前默认的 Key Block 和 Record Block 缓存（当前为 3 MiB / 5 MiB）。

```powershell
cargo run --offline --manifest-path tests/native/mdict-cache-probe/Cargo.toml --target-dir native/mdict/target -- "C:\path\dictionary.mdx"
```

程序直接编译应用的原始解析器和 `BlockCache` 源文件，只在诊断模块内添加读取缓存状态的方法，不修改业务源码或词典。输出为制表符分隔的指标和值。Windows 下另输出本进程工作集和私有提交字节数，包含分配器和 mmap 等影响，不代表 Electron 的总内存。

测量步骤：

1. 读取块目录，统计物理记录数及解压大小。
2. 逐块调用实际解码函数，填充两个真实 LRU；每次读取使用与随机查询相同的缓存路径。
3. 检查保留字节数等于实际缓存块大小总和，且不超过容量。
4. 全部 Record Block 读取后，LRU 保留文件末尾附近的块。统计其中完全覆盖的非空记录、跨边界记录及 `@@@LINK=` 记录；检查统计期间没有改变缓存成员。
5. 关闭首个实例，再用不填充 LRU 的顺序游标统计全文件的跳转记录与其他记录。

块不能拆分以填补剩余容量；如果文件全部 Key Block 小于缓存容量，缓存全部内容即结束，不制造重复副本。覆盖数量依赖访问顺序，当前使用文件顺序，不能代表任意随机查询下的固定容量。词头/记录数是物理记录数，包含重复词头、词形和跳转记录；非跳转记录也不保证与独立单词一一对应。

`oaldpe-result.tsv` 保留调整前 32 MiB / 64 MiB 的基线；`oaldpe-small-cache-result.tsv` 为调整至 3 MiB / 5 MiB 后的结果。

`smoke.cjs` 对比旧容量与新容量下的 MDX 重复读取，以及关闭 Record 缓存后的 MDD 重复读取。指定已构建的 Node 原生库和 MDX 路径；程序会读取同目录下对应的 MDD 分卷：

```powershell
node --expose-gc tests/native/mdict-cache-probe/smoke.cjs "C:\path\binding.node" "C:\path\dictionary.mdx"
```
