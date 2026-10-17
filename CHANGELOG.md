# Changelog

本项目的所有重要改动都会记录在这里，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-10-17

### 新增

- 「设置 → 插件榜单」设置页：日榜 / 周榜 / 月榜切换，显示排名、下载量、占比条、作者与简介。
- 宿主端抓取 awesome-dsh-plugin 社区目录，并向 npm downloads point API 查询实时下载量。
- 批量查询（≤128 个/次）与 scoped 包逐个查询，带 429 重试、请求间隔和 120 秒截止时间。
- 榜单缓存 6 小时、单包计数缓存 24 小时，写盘采用临时文件 + rename，重启后不丢。
- 限流时自动降级为目录自带的 30 天下载量，并在界面上明确标注。
- 抓取进度展示（进度条 + 百分比），抓取中的页面每 2 秒轮询。
- 点击任意一行复制目录提供的安装命令，支持键盘操作。
- 空窗口自动触发首次抓取。
- `GET /.dsh-rank-board/board` 与 `POST /.dsh-rank-board/refresh` 本机 HTTP 接口。
- 冒烟测试与抓取流程测试（mock fetch），GitHub Actions CI。

### 修复

- 社区目录的 `description` 是 `{ en, zh }` 对象，此前按字符串读取导致榜单简介全为空。
- 复制安装命令时不再硬编码 `--profile desktop`，改用目录条目自带的 `install` 字段。
