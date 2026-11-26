# SQLite `simple` extension

These platform libraries are extracted unmodified from the upstream `simple`
v0.7.1 release: <https://github.com/wangfenjin/simple/releases/tag/v0.7.1>.
Only the shared library is included; the archived Jieba dictionaries are not
needed by Dictol's `simple 0` tokenizer or `simple_query(..., 0)` searches.

| Archive                       | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `libsimple-osx-x64.zip`       | `d6f7e9fc9dac3c2bcfb5389618d41f2f0db6ea5a83dd8b9a363cf9b02fa20f95` |
| `libsimple-osx-arm64.zip`     | `b699f0fca1e7d1f8776d067708ecf4d0bcc2d765e4b643862e129058583b885f` |
| `libsimple-windows-x64.zip`   | `7f03cc28cf307721f5621b5a52ef3bcb26c5215de012b09900492eb34d5bed0b` |
| `libsimple-windows-arm64.zip` | `520c33aae3fab35cba963927d04f041f971eee71f01fa577fb1d51e171780687` |

The shared libraries are stored in the matching platform/architecture folders.
Upstream license terms are in [LICENSE](./LICENSE).
