# NCAuto 技术原理（详细版）

> 一句话：NovelCrafter 官网说“不支持导入”，指的只是没做按钮。
> 网页是 API 的一层皮，浏览器里每个操作都有对应的网络请求，
> 照抄这些请求就能把导出包原样写回去。本文记录全部发现，可复现。

---

## 1. 背景

- 官方文档（2026 年 6 月）明确：Codex 只能导出 zip，不能导入，需手动逐条新建或用 Extract。
- 导出入口：Codex 侧边栏齿轮 → 导出，产物为 zip。
- 目标：把导出的 zip（含 Codex / Snippets / Chats）批量写回任意自己有写权的书。

## 2. 导出格式（输入侧）

### 2.1 Codex 导出（`- codex.zip`）

```
<characters|locations|lore|objects|subplots|other>/<名字>-<27位id>/
    metadata.json   # {id, attributes:{type,name,color,aliases,tags,
                    #   alwaysIncludeInContext,doNotTrack,noAutoInclude},
                    #  relationships:{nestedEntries:[id...]}, links:{...}}
    entry.md        # YAML frontmatter + Markdown 正文（描述）
    notes.md        # 研究笔记纯文本（有才存在）
codex.html          # 汇总预览，可忽略
```

- 类型枚举（文件夹复数 ↔ 记录值单数）：`characters→character`、`locations→location`、
  `lore→lore`、`objects→object`、`subplots→subplot`、`other→other`。
- 导出字段名与写入接口字段名有一处不同：`alwaysIncludeInContext`（导出）↔ `alwaysInclude`（接口）。

### 2.2 整项目导出（`- full.zip`，导出向导三项全勾）

在 2.1 基础上根目录多出：

```
novel.md                 # 手稿正文（导入用不上）
snippets/<YYYY-MM-DD> [<标题> - ]<id前8>.md
codex.html
```

`snippets/*.md` 格式：frontmatter（`title`/`favourite`）+ 纯文本正文，空行分段。
注意只保留 id 前 8 位，没有完整 id，导入必须生成新 id。

### 2.3 对话导出（`- chats.zip`，或 full 导出勾选 Chats）

```
<YYYY-MM-DD> [<标题> - ]<id前8>.md   # 根目录或 chats/ 子目录
```

frontmatter 同 snippet；正文按角色标题分段：`## User` / `## AI`（`Assistant` 同义）/ `## System`。

## 3. 抓包方法（输出侧是怎么发现的）

1. Playwright 起带 HAR 录制的 Chromium，用户手动登录并打开目标书。
2. 手动新建 1 条 Codex（名字用 `TEST_PROBE_xxx` 好定位），等 3 秒自动保存。
3. 在 HAR 里搜 `TEST_PROBE`，命中真正的写入请求（之前按 `codex|entries` 关键词只抓到 Sentry 上报——教训：按特征字符串搜，别按猜的 URL 关键词）。
4. 结论：写入走 `app.novelcrafter.com/api/trpc/data.commit`，写正文走 `data.updateOne`。

## 4. 鉴权

- 登录态：Cookie `__session`（**非 HttpOnly，前端可读**）存 JWT；请求头 `Authorization: Bearer <JWT>`。
- userId = JWT payload 的 `sub`（base64url 解码）。不要拼 `__session_*` 后缀 Cookie，会 401。
- 常用头：`novelcrafter-client-version: client@f81152`、`novelcrafter-client-time: <毫秒戳>`、
  `novelcrafter-client-token-time: 0`、`content-type: application/json`。
- 油猴脚本方案：被动截获 app 自身发出的 trpc 请求头（Authorization + client-version），
  Cookie 由浏览器自动带。token 轮换也不怕，永远用最新截获的。

## 5. tRPC 信封格式

- 查询：`GET /api/trpc/<过程>?batch=1&input=<URL编码的 {"0":{"json":<入参>}}>`。
- 变更：`POST /api/trpc/<过程>?batch=1`，body `{"0":{"json":<入参>},"meta":{...}}`。
- 成功：`[{"result":{"data":{"json":...}}}]`；失败：`[{"error":{"json":{"message","code","data":{"code","httpStatus","path"}}}}]`。
- 入参不对报 `BAD_REQUEST` 400；过程名不存在报 `NOT_FOUND` 404（可用来探测接口存在性）。
- Date 类型要配套 `meta.values` 声明（如 `"transaction.upsert.0.meta.createdAt": ["Date"]`），
  **一次 commit 打包多条 upsert 时，每个下标都要声明**，否则 400。

## 6. 端点清单（实测）

| 过程 | 方法 | 入参 | 用途 | 状态 |
|---|---|---|---|---|
| `data.getAll` | GET | novelId **字符串本体**（传对象会 400） | 读整书所有记录：novels/novelDetails/acts/chapters/scenes/codexEntries/snippets/chatThreads/chatMessages | ✅ |
| `data.commit` | POST | 见 §7 | upsert 任意记录 | ✅ |
| `data.updateOne` | POST | 见 §7.5 | 更新单条的部分字段/关联 | ✅ |
| `snippets.getAll` | GET | novelId 字符串 | 读片段 | ✅ |
| `novels.getPermissions` | GET | novelId 字符串 | 查当前账号对书的 role/canWrite（写前预检） | ✅ |
| `snippets.create/upsert/update/...` | — | — | 全部 404：**没有 snippet 专用写接口**，一律走 `data.commit` | ❌ |

## 7. 记录 payload 详解

### 7.1 `codexEntries`

```json
{
  "id": "<27位id>", "type": "codexEntries",
  "meta": {"createdAt": "<ISO>", "updatedAt": "<ISO>", "state": "active"},
  "attributes": {
    "type": "character|location|object|lore|subplot|other",
    "name": "…", "description": "<p>…</p>", "notes": "<p>…</p> 或 null",
    "tags": [], "aliases": [],
    "alwaysInclude": false, "doNotTrack": false, "noAutoInclude": false,
    "hideFromAi": false, "promptInclusions": null,
    "matchExclusions": [], "matchCaseSensitive": false, "color": null
  },
  "fields": {},
  "relationships": {
    "nestedEntries": ["<关联条目id>"],
    "belongsTo": {"type": "novels", "id": "<novelId>"},
    "connections": []
  },
  "links": {"thumbnail": null, "externalReferences": []}
}
```

- `description`（Details）/`notes`（Research）都是 **HTML**，段落 `<p>`、段内换行 `<br>`。
  导出是 Markdown：按空行切段包 `<p>`，段内 `\n` 转 `<br>`，并转义 `&<>"'`。
- `context.event.name` 用 `codex_entry_created`（服务端不校验，可自定义）。
- 写入分两步（与官网手动建条目行为一致）：① commit 建空条目 → ② updateOne 写详情。
  updateOne 的 `context` 传 `null` 即可；`relationships.nestedEntries` 是**整体替换**。

### 7.2 `snippets`

```json
{
  "id": "<新id>", "type": "snippets",
  "attributes": {"title": "…", "favourite": false,
    "content": {"type": "doc", "content": [...]}},
  "relationships": {"belongsTo": {"type": "novels", "id": "<novelId>"}}, "links": {}
}
```

- 正文是 **ProseMirror/Tiptap JSON**（不是 HTML）：空行分段；单行 `#` 为 heading；
  全是 `-/*/+` 开头为 bulletList；全是 `1.` 开头为 orderedList；段内换行转 hardBreak。
- 事件名 `snippet_created`，一次 commit 一条即可。

### 7.3 `chatMessages` + `chatThreads`

```json
// 消息
{"type": "chatMessages",
 "attributes": {"type": "user|ai|system", "text": "纯文本", "model": null},
 "relationships": {}}
// 线程
{"type": "chatThreads",
 "attributes": {"title": "", "favourite": false,
   "includeOutlineInContext": false, "includeAllTextInContext": false,
   "inputs": {}, "memoryCutoff": 14, "thinking": null},
 "relationships": {"messages": ["<按时间序的消息id>"], "prompt": null, "model": null, "sceneContext": null}}
```

- 顺序：先一次 commit 建全部消息（多 upsert，meta 逐下标声明），再建线程挂 `messages`。
- 无 `belongsTo`，归属由 commit 的 `context.scope.novelId` 决定。

### 7.4 ID 机制（重点）

- ID 是 27 位 base62 的 KSUID（时间可排序全局唯一），空间 62^27 ≈ 2^161。
  随机碰撞概率约 4×10^-49， birthday 攻击下 10^12 条才 2×10^-25——工程上视为不可能。
- `data.commit` 按 ID upsert：无此 ID → 插入；有 → 原地覆盖（所以**沿用 ID 重复导入天然幂等**）。
- **跨账号沿用旧 ID 会 403**：ID 全局主键且带归属，upsert 到别人拥有的 ID 等于试图改别人的行。
  实测：同账号跨书复用 ✅；跨账号复用 ❌（`FORBIDDEN -32003`）；全新随机 ID ✅。
- 结论：导自己的包可沿用 ID（增量同步不造副本）；导别人的包必须用新 ID
  （关联按“旧ID→名→新ID”重链，整包迁移不断链）。

### 7.5 权限模型

- 403 `You do not have permission to edit model "novels:<id>"` 是服务端最终裁决：
  读（getAll）正常但写被拒 = 当前账号对这本书无写权（只读分享 / 登错号 / 跨账号 ID）。
- 写前先调 `novels.getPermissions` 看 `role`/`canWrite`，不对直接停手，别批量撞墙。

## 8. 导入流程（NCAuto 实现）

```
解析 zip/folder/json → 三组列表（Codex/Snippets/Chats，可逐组全选）
  → 权限预检 → 读已有索引（名→id：判重 + 关联重链）
  → 第一遍 data.commit 建条目/片段/消息/线程
  → 第二遍 data.updateOne 写 Codex 详情（正文+笔记+关联）
  → 汇总 log → 用户刷新页面（前端缓存不实时，以 data.getAll 为准）
```

- 跳过重名：Codex 按名、片段按标题、对话按标题（空标题不判重）。
- 关联重链：引用 ID 在本次导入集合里 → 直连；指向被跳过的已有条目 → 按名重链；
  两头都找不到 → 丢弃并计数。
- 节流：默认 200ms/发 + 随机抖动，429/成片失败就调大。

## 9. 坑位清单

1. 按 URL 关键词过滤 HAR 会漏：Sentry 上报也含关键词，按特征内容搜。
2. `data.getAll` 入参是字符串本体，包成对象就 400。
3. 多 upsert 的 `meta.values` 必须逐下标声明 Date。
4. `nestedEntries` 更新是整体替换，不是追加。
5. 面板自身在 body 里：用 `innerText` 判重必须先藏起面板，否则全判重名。
6. JSZip 文件对象用 `.async('text')`，原生 File 才有 `.text()`。
7. 油猴 `@require` 的 CDN 在国内可能 whole-script 失败：改懒加载 + 多 CDN 兜底。
8. 写入后读可能短暂不一致，校验前稍等；侧边栏不实时，刷新为准。
9. 发文章/截图前脱敏：JWT、userId、novelId、私有书名一个别留。

## 10. 风险声明

逆向的是私有接口，无版本承诺，官网改版可能随时失效（症状：成片 4xx）。
本工具只操作登录者自己有写权的书，不绕过任何服务端权限检查。
发布时请保留本声明。

## 11. 致谢

Snippet/Chat 报文、整包导出结构、幂等 ID 方案借鉴了第三方 `ncauto` 研究
（`NOTES.md` + `ncimport*.mjs` 系列）；油猴零安装路线为本项目独立实现。
