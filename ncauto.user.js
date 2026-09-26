// ==UserScript==
// @name         NCAuto · NovelCrafter 全量导入
// @namespace    local.ncauto
// @version      0.4.0
// @description  Codex + Snippets + Chats 全量导入 | Bulk import via the app's own trpc API. English UI unless browser language is Chinese.
// @author       you
// @license      MIT
// @icon         https://www.novelcrafter.com/favicon.ico
// @match        https://app.novelcrafter.com/novels/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==
// 注：JSZip 改为按需懒加载（只在选 zip 时加载），避免 CDN 挡住整个脚本运行。

(function () {
  'use strict';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const logLines = [];
  function log(msg) {
    logLines.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    const el = document.getElementById('nca-log');
    if (el) { el.textContent = logLines.slice(-300).join('\n'); el.scrollTop = el.scrollHeight; }
    console.log('[NCA]', msg);
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escHtml = esc;

  // ---------- 双语：中文浏览器显示中文，否则英文 ----------
  const LANG = (navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  const STR = {
    appTitle: { zh: '📚 NCAuto 全量导入', en: '📚 NCAuto Bulk Import' },
    authOk: { zh: '✅ 凭证已捕获 ({time})，可以直接导入', en: '✅ Auth captured ({time}), ready to import' },
    authWait: { zh: '⏳ 等待捕获凭证（在页面里随便点点/等几秒，app 会自动发请求）…', en: '⏳ Waiting for auth (click around or wait a few seconds while the app sends requests)…' },
    untitled: { zh: '(无标题)', en: '(untitled)' },
    msgs: { zh: '[{n} 条消息]', en: '[{n} messages]' },
    y: { zh: '有', en: 'yes' },
    n: { zh: '无', en: 'no' },
    steps: { zh: '{a} ①凭证  {b} ②数据(已选{n})  ▶ ③导入', en: '{a} ①Auth  {b} ②Data ({n} selected)  ▶ ③Import' },
    countLine: { zh: 'Codex {a}/{b} · 片段 {c}/{d} · 对话 {e}/{f}', en: 'Codex {a}/{b} · Snippets {c}/{d} · Chats {e}/{f}' },
    loadStep: { zh: '① 加载数据', en: '① Load data' },
    pickZip: { zh: '📦 选 zip / JSON', en: '📦 Pick zip / JSON' },
    pickFolder: { zh: '📁 选文件夹', en: '📁 Pick folder' },
    noSrc: { zh: '尚未选择数据', en: 'No data selected yet' },
    srcHint: { zh: '官方 full.zip / codex.zip / chats.zip，或 JSON，或直接选解压后的文件夹', en: 'Official full.zip / codex.zip / chats.zip, JSON, or an extracted folder' },
    selAll: { zh: '全选', en: 'Select all' },
    selNone: { zh: '全不选', en: 'Select none' },
    skipDup: { zh: '跳过重名', en: 'Skip duplicates' },
    reuseId: { zh: '沿用导出ID', en: 'Reuse exported IDs' },
    reuseTip: { zh: '沿用导出包里的原始ID，关联最精确；若导入别人账号导出的包被403，关掉它', en: 'Reuse original IDs from the export (best for relations). Turn off when a 403 comes from importing another account\u2019s export.' },
    importStep: { zh: '② 导入', en: '② Import' },
    delayMs: { zh: '间隔', en: 'Delay' },
    dryRun: { zh: '试运行', en: 'Dry run' },
    goBtn: { zh: '🚀 开始导入', en: '🚀 Start import' },
    copyBtn: { zh: '📋 复制日志', en: '📋 Copy log' },
    minTip: { zh: '最小化成小圆点', en: 'Minimize to a dot' },
    dotTip: { zh: 'Codex 导入（可拖动，点击展开）', en: 'NCAuto import (draggable, click to expand)' },
    notDetected: { zh: '(未识别)', en: '(not detected)' },
    userRetry: { zh: '(未识别，导入时自动重试)', en: '(not detected, will retry on import)' },
    srcPicked: { zh: '已选：{f}', en: 'Selected: {f}' },
    srcFolder: { zh: '已选文件夹：{f}（{n} 个文件）', en: 'Selected folder: {f} ({n} files)' },
    loaded: { zh: '已加载 Codex {a} · 片段 {b} · 对话 {c}（{f}）', en: 'Loaded: Codex {a} · Snippets {b} · Chats {c} ({f})' },
    loadedFolder: { zh: '已加载 Codex {a} · 片段 {b} · 对话 {c}（文件夹）', en: 'Loaded: Codex {a} · Snippets {b} · Chats {c} (folder)' },
    loadFail: { zh: '加载失败: {e}', en: 'Load failed: {e}' },
    zipFound: { zh: 'zip 内找到 {n} 个 entry.md', en: 'Found {n} entry.md in zip' },
    zipSummary: { zh: 'zip：Codex {a} · 片段 {b} · 对话 {c}', en: 'Zip: Codex {a} · Snippets {b} · Chats {c}' },
    folderFound: { zh: '文件夹内找到 {n} 个 entry.md', en: 'Found {n} entry.md in folder' },
    folderSummary: { zh: '文件夹：Codex {a} · 片段 {b} · 对话 {c}', en: 'Folder: Codex {a} · Snippets {b} · Chats {c}' },
    jszipFail: { zh: 'JSZip 加载失败，请改用 JSON 或文件夹方式', en: 'JSZip failed to load, use JSON or folder instead' },
    ready: { zh: '面板就绪。先等凭证 ✅，再加载数据导入。', en: 'Panel ready. Wait for ✅ auth, then load data and import.' },
    copied: { zh: '日志已复制，粘贴即可', en: 'Log copied, paste anywhere' },
    emptyLog: { zh: '(日志为空)', en: '(log empty)' },
    alertNovel: { zh: '没识别到 novelId，请确认打开的是某本书里的页面（URL 含 /novels/xxx/）', en: 'novelId not detected. Open a page inside a book (URL contains /novels/xxx/).' },
    alertAuth: { zh: '还没捕获到凭证：在页面里随便点点（切个 Codex 条目看看），等状态变成 ✅ 再点', en: 'No auth captured yet: click around the page (open a Codex entry) and wait for ✅.' },
    promptUser: { zh: '没自动找到 userId（形如 user_xxx），请在页面 HTML 里搜 user_ 后粘进来：', en: 'userId not auto-detected (looks like user_xxx). Search the page HTML for user_ and paste it:' },
    alertEmpty: { zh: '先加载并勾选要导入的条目', en: 'Load data and tick entries to import first.' },
    drySummary: { zh: '试运行：Codex {a} · 片段 {b} · 对话 {c}，novelId={n}', en: 'Dry run: Codex {a} · Snippets {b} · Chats {c}, novelId={n}' },
    dryEntry: { zh: '--- {name} [{type}] id={id} 笔记={notes} 关联={rel} ---', en: '--- {name} [{type}] id={id} notes={notes} relations={rel} ---' },
    drySnip: { zh: '--- 片段 {t} ★={f} ---', en: '--- Snippet {t} ★={f} ---' },
    dryChat: { zh: '--- 对话 {t} {n} 条({m}) ---', en: '--- Chat {t} {n} msgs ({m}) ---' },
    permLine: { zh: '本书权限：role={r} 可写={w}', en: 'Book permission: role={r} canWrite={w}' },
    noPerm: { zh: '⛔ 当前账号对这本书没有写权限。请确认：① 打开的是你自己账号下创建的书；② 没登错账号；③ 如果是别人分享的书，需要对方给编辑权限。', en: '⛔ This account cannot write to this book. Make sure: ① you opened a book created under your own account; ② you are logged into the right account; ③ a shared book needs edit permission from its owner.' },
    alertPerm: { zh: '当前账号对这本书没有写权限，详见日志', en: 'This account cannot write to this book, see log for details' },
    permFail: { zh: '查权限失败，继续尝试导入: {e}', en: 'Permission check failed, trying anyway: {e}' },
    existCount: { zh: '目标书已有 {n} 个 codex 条目', en: 'Target book already has {n} codex entries' },
    readFail: { zh: '读已有条目失败，改用页面文本比对: {e}', en: 'Failed to read existing entries, falling back to page-text match: {e}' },
    skipName: { zh: '跳过重名: {n}', en: 'Skip duplicate: {n}' },
    hint403: { zh: '（沿用ID可能被拒：关掉“沿用导出ID”再试一条）', en: ' (reused IDs may be rejected: turn off “Reuse exported IDs” and retry one)' },
    skipSnip: { zh: '跳过同名片段: {n}', en: 'Skip duplicate snippet: {n}' },
    skipThread: { zh: '跳过同名对话: {n}', en: 'Skip duplicate chat: {n}' },
    skipEmpty: { zh: '跳过空对话: {n}', en: 'Skip empty chat: {n}' },
    progBuild: { zh: '建条目 {a}/{b}', en: 'Creating entries {a}/{b}' },
    progDetail: { zh: '写详情 {a}/{b}', en: 'Writing details {a}/{b}' },
    progSnip: { zh: '片段 {a}/{b}', en: 'Snippets {a}/{b}' },
    progChat: { zh: '对话 {a}/{b}', en: 'Chats {a}/{b}' },
    phaseSnip: { zh: '--- 片段 {n} 条 ---', en: '--- {n} snippets ---' },
    phaseChat: { zh: '--- 对话 {n} 个 ---', en: '--- {n} chats ---' },
    failDetail: { zh: '✗ 详情写入失败 {n}: {e}', en: '✗ Detail write failed for {n}: {e}' },
    okSnip: { zh: '✓ 片段 [{a}/{b}] {n}', en: '✓ Snippet [{a}/{b}] {n}' },
    failSnip: { zh: '✗ 片段 {n}: {e}', en: '✗ Snippet {n}: {e}' },
    okChat: { zh: '✓ 对话 [{a}/{b}] {n}（{m} 条消息）', en: '✓ Chat [{a}/{b}] {n} ({m} messages)' },
    failChat: { zh: '✗ 对话 {n}: {e}', en: '✗ Chat {n}: {e}' },
    done: { zh: '完成：成功 {ok}，失败 {fail}，跳过 {skip}，关联丢弃 {rel}（目标不在本次导入+书中也无同名时丢弃）。去书里确认数量，Codex/Snippets/Chats 对上就刷新页面。', en: 'Done: {ok} ok, {fail} failed, {skip} skipped, {rel} relations dropped (target neither in this batch nor in the book by name). Verify counts (Codex/Snippets/Chats), then refresh.' },
  };
  function t(k, v) {
    const d = STR[k] || {};
    let s = d[LANG] || d.en || k;
    if (v) for (const key of Object.keys(v)) s = s.split('{' + key + '}').join(v[key]);
    return s;
  }

  // ---------- 凭证：被动截获 app 自己的 trpc 请求头 ----------
  const auth = { authorization: null, clientVersion: null, seenAt: 0 };
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    try {
      const [input, init = {}] = args;
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/api/trpc')) {
        const h = init.headers || {};
        const get = (n) => {
          if (h instanceof Headers) return h.get(n);
          if (Array.isArray(h)) { const f = h.find(([k]) => String(k).toLowerCase() === n); return f && f[1]; }
          return h[n] || h[Object.keys(h).find((k) => k.toLowerCase() === n)];
        };
        const a = get('authorization');
        const v = get('novelcrafter-client-version');
        if (a) { auth.authorization = a; auth.seenAt = Date.now(); }
        if (v) auth.clientVersion = v;
        renderAuth();
      }
    } catch (e) { /* ignore */ }
    return origFetch.apply(this, args);
  };

  function baseHeaders() {
    const h = { 'Content-Type': 'application/json' };
    if (auth.authorization) h['Authorization'] = auth.authorization;
    if (auth.clientVersion) h['novelcrafter-client-version'] = auth.clientVersion;
    h['novelcrafter-client-time'] = String(Date.now());
    h['novelcrafter-client-token-time'] = '0';
    return h;
  }

  // ---------- 上下文：novelId / userId ----------
  function detectNovelId() {
    const m = location.pathname.match(/\/novels\/([A-Za-z0-9]+)/);
    return m ? m[1] : null;
  }
  function detectUserId() {
    // 首选：__session cookie 里 JWT 的 sub（比翻 HTML 稳）
    try {
      const m = document.cookie.match(/(?:^|;\s*)__session=([^;]+)/);
      if (m) {
        let b64 = decodeURIComponent(m[1]).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        const payload = JSON.parse(atob(b64));
        if (payload.sub) return payload.sub;
      }
    } catch (e) { /* fallback 下方 */ }
    const r = document.documentElement.innerHTML.match(/user_[A-Za-z0-9]+/);
    return r ? r[0] : null;
  }

  // ---------- 数据：三类 ----------
  let entries = [];   // codex
  let snippets = [];  // {title,favourite,body,_checked}
  let chats = [];     // {title,favourite,messages:[{type,text}],file,_checked}

  function parseFrontmatter(mdText) {
    if (!mdText.startsWith('---')) return [{}, mdText];
    const parts = mdText.split('---');
    if (parts.length < 3) return [{}, mdText];
    const fmRaw = parts[1];
    const body = parts.slice(2).join('---').trim();
    const meta = {};
    let cur = null;
    for (const line of fmRaw.split('\n')) {
      if (!line.trim()) continue;
      const s = line.trim();
      if (s.startsWith('- ')) {
        const v = s.slice(2).trim();
        if (cur && Array.isArray(meta[cur])) meta[cur].push(v);
        continue;
      }
      const idx = line.indexOf(':');
      if (idx > -1) {
        const k = line.slice(0, idx).trim();
        const v = line.slice(idx + 1).trim();
        if (v === '') { meta[k] = (k === 'aliases' || k === 'tags') ? [] : ''; cur = k; }
        else if (v === '[]') { meta[k] = []; cur = k; }
        else if (v === '{}') { meta[k] = {}; cur = null; }
        else if (v === 'null') { meta[k] = null; cur = null; }
        else if (v === 'true' || v === 'false') { meta[k] = v === 'true'; cur = null; }
        else { meta[k] = v; cur = null; }
      }
    }
    return [meta, body];
  }

  function ensureJSZip() {
    if (window.JSZip) return Promise.resolve();
    const cdns = [
      'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
      'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
      'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js',
    ];
    const tryOne = (i) => {
      if (i >= cdns.length) return Promise.reject(new Error(t('jszipFail')));
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = cdns[i];
        s.onload = () => resolve();
        s.onerror = () => { s.remove(); tryOne(i + 1).then(resolve, reject); };
        document.head.appendChild(s);
      });
    };
    return tryOne(0);
  }

  // snippet/chat 通用 frontmatter（title 可能带引号）
  function parseSimpleFM(md) {
    const m = (md || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!m) return { fm: {}, body: (md || '').trim() };
    const fm = {};
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([\w]+):\s*(.*)$/);
      if (!kv) continue;
      let v = kv[2].trim();
      if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1);
      if (v === 'true') v = true; else if (v === 'false') v = false;
      fm[kv[1]] = v;
    }
    return { fm, body: m[2].replace(/\s+$/, '') };
  }
  function isChatBody(body) {
    return /^##\s*(User|AI|Assistant|System)\s*$/im.test(body || '');
  }
  function parseChatMsgs(body) {
    const msgs = [];
    let cur = null;
    for (const ln of (body || '').split(/\r?\n/)) {
      const m = ln.match(/^##\s*(User|AI|Assistant|System)\s*$/i);
      if (m) {
        if (cur) msgs.push(cur);
        const r = m[1].toLowerCase();
        cur = { type: r === 'user' ? 'user' : r === 'system' ? 'system' : 'ai', lines: [] };
        continue;
      }
      if (cur) cur.lines.push(ln);
    }
    if (cur) msgs.push(cur);
    return msgs.map((x) => ({ type: x.type, text: x.lines.join('\n').trim() })).filter((x) => x.text);
  }
  // 纯文本 -> ProseMirror doc（标题/无序/有序/硬换行，与导出格式对应）
  function pmInline(s) {
    const out = [];
    s.split('\n').forEach((p, i) => { if (i > 0) out.push({ type: 'hardBreak' }); if (p) out.push({ type: 'text', text: p }); });
    if (!out.length) out.push({ type: 'text', text: '' });
    return out;
  }
  function textToDoc(text) {
    const lines = (text || '').replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let cur = [];
    for (const ln of lines) { if (ln.trim() === '') { if (cur.length) { blocks.push(cur); cur = []; } } else cur.push(ln); }
    if (cur.length) blocks.push(cur);
    const content = [];
    for (const b of blocks) {
      let m;
      if ((m = b[0].match(/^(#{1,6})\s+(.*)$/)) && b.length === 1) { content.push({ type: 'heading', attrs: { level: m[1].length }, content: pmInline(m[2]) }); continue; }
      if (b.every((l) => /^\s*[-*+]\s+/.test(l))) { content.push({ type: 'bulletList', content: b.map((l) => ({ type: 'listItem', content: [{ type: 'paragraph', content: pmInline(l.replace(/^\s*[-*+]\s+/, '')) }] })) }); continue; }
      if (b.every((l) => /^\s*\d+[.)]\s+/.test(l))) { content.push({ type: 'orderedList', content: b.map((l) => ({ type: 'listItem', content: [{ type: 'paragraph', content: pmInline(l.replace(/^\s*\d+[.)]\s+/, '')) }] })) }); continue; }
      content.push({ type: 'paragraph', content: pmInline(b.join('\n')) });
    }
    if (!content.length) content.push({ type: 'paragraph' });
    return { type: 'doc', content };
  }

  // 通用 commit：一条或多条 upsert（多条时 meta.values 必须逐下标声明 Date）
  async function commitRecords(novelId, userId, recs, eventName) {
    const now = new Date().toISOString();
    const values = { 'context.0.event.timestamp': ['Date'] };
    recs.forEach((_, i) => {
      values[`transaction.upsert.${i}.meta.createdAt`] = ['Date'];
      values[`transaction.upsert.${i}.meta.updatedAt`] = ['Date'];
    });
    const body = {
      0: {
        json: {
          novelId,
          transaction: {
            upsert: recs.map((r) => ({
              id: r.id, type: r.type,
              meta: { createdAt: now, updatedAt: now, state: 'active' },
              attributes: r.attributes, fields: {},
              relationships: r.relationships, links: r.links || {},
            })),
          },
          context: [{ event: { timestamp: now, userId, name: eventName, data: {} }, scope: { novelId } }],
        },
        meta: { values, referentialEqualities: { 'context.0.event.timestamp': ['transaction.upsert.0.meta.updatedAt'] }, v: 1 },
      },
    };
    const r = await origFetch('/api/trpc/data.commit?batch=1', {
      method: 'POST', headers: baseHeaders(), credentials: 'include', body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`commit HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }

  async function loadZip(file) {
    await ensureJSZip();
    const zip = await JSZip.loadAsync(file);
    const paths = [];
    zip.forEach((p, ze) => { if (p.endsWith('entry.md') && !ze.dir) paths.push(p); });
    log(t('zipFound', { n: paths.length }));
    const out = [];
    for (const p of paths) {
      const [fm, body] = parseFrontmatter(await zip.file(p).async('text'));
      const dir = p.split('/').slice(0, -1).join('/');
      let name = fm.name || '', etype = (fm.type || 'other').toLowerCase();
      let aliases = fm.aliases || [], tags = fm.tags || [];
      let extra = { color: fm.color ?? null, alwaysInclude: !!fm.alwaysIncludeInContext, doNotTrack: !!fm.doNotTrack, noAutoInclude: !!fm.noAutoInclude };
      let source_id = null, nested = [];
      if (zip.file(dir + '/metadata.json')) {
        try {
          const mj = JSON.parse(await zip.file(dir + '/metadata.json').async('text'));
          const a = mj.attributes || {};
          name = a.name ?? name; etype = (a.type ?? etype).toLowerCase();
          aliases = a.aliases ?? aliases; tags = a.tags ?? tags;
          extra = { color: a.color ?? null, alwaysInclude: !!(a.alwaysInclude ?? a.alwaysIncludeInContext), doNotTrack: !!a.doNotTrack, noAutoInclude: !!a.noAutoInclude };
          source_id = mj.id || null;
          nested = ((mj.relationships || {}).nestedEntries) || [];
        } catch (e) { /* ignore */ }
      }
      if (!source_id) {
        const mm = dir.match(/-([A-Za-z0-9]{27})$/); // 文件夹名尾缀 -<id> 兜底
        if (mm) source_id = mm[1];
      }
      let notes = '';
      if (zip.file(dir + '/notes.md')) {
        try { notes = (await zip.file(dir + '/notes.md').async('text')).trim(); } catch (e) { /* ignore */ }
      }
      if (name) out.push({ type: etype, name, description: body, notes, nestedEntries: nested, source_id, aliases, tags, ...extra, _checked: true });
    }
    // 片段 + 对话：snippets/ 下的是片段；chats/ 或根目录下带 ## User/AI 角色标题的是对话
    const snips = [], chs = [];
    const mdPaths = [];
    zip.forEach((p, ze) => { if (!ze.dir && p.toLowerCase().endsWith('.md')) mdPaths.push(p); });
    for (const p of mdPaths) {
      const low = p.toLowerCase();
      if (p.endsWith('entry.md') || low.endsWith('/notes.md') || low.endsWith('novel.md')) continue;
      const { fm, body } = parseSimpleFM(await zip.file(p).async('text'));
      const item = { title: fm.title || '', favourite: fm.favourite === true, body, _checked: true };
      if (low.includes('/snippets/') || low.startsWith('snippets/')) {
        snips.push(item);
      } else if (isChatBody(body)) {
        chs.push({ ...item, messages: parseChatMsgs(body), file: p.split('/').pop() });
      } else if (low.includes('/chats/') || low.startsWith('chats/')) {
        chs.push({ ...item, messages: parseChatMsgs(body), file: p.split('/').pop() });
      } else if (!low.includes('/characters/') && !low.includes('/locations/') && !low.includes('/lore/') && !low.includes('/objects/') && !low.includes('/subplots/') && !low.includes('/other/')) {
        snips.push(item); // 零散 md 默认当片段
      }
    }
    log(t('zipSummary', { a: out.length, b: snips.length, c: chs.length }));
    return { codex: out, snippets: snips, chats: chs };
  }

  async function loadFileList(files) {
    const byPath = new Map(files.map((f) => [f.webkitRelativePath || f.name, f]));
    const mdPaths = [...byPath.keys()].filter((p) => p.endsWith('entry.md'));
    log(t('folderFound', { n: mdPaths.length }));
    const out = [];
    for (const p of mdPaths) {
      const [fm, body] = parseFrontmatter(await byPath.get(p).text());
      const dir = p.split('/').slice(0, -1).join('/');
      let name = fm.name || '', etype = (fm.type || 'other').toLowerCase();
      let aliases = fm.aliases || [], tags = fm.tags || [];
      let extra = { color: fm.color ?? null, alwaysInclude: !!fm.alwaysIncludeInContext, doNotTrack: !!fm.doNotTrack, noAutoInclude: !!fm.noAutoInclude };
      const mjFile = byPath.get(dir + '/metadata.json');
      let source_id = null, nested = [];
      if (mjFile) {
        try {
          const mj = JSON.parse(await mjFile.text());
          const a = mj.attributes || {};
          name = a.name ?? name; etype = (a.type ?? etype).toLowerCase();
          aliases = a.aliases ?? aliases; tags = a.tags ?? tags;
          extra = { color: a.color ?? null, alwaysInclude: !!(a.alwaysInclude ?? a.alwaysIncludeInContext), doNotTrack: !!a.doNotTrack, noAutoInclude: !!a.noAutoInclude };
          source_id = mj.id || null;
          nested = ((mj.relationships || {}).nestedEntries) || [];
        } catch (e) { /* ignore */ }
      }
      if (!source_id) {
        const mm = dir.match(/-([A-Za-z0-9]{27})$/);
        if (mm) source_id = mm[1];
      }
      let notes = '';
      const notesFile = byPath.get(dir + '/notes.md');
      if (notesFile) {
        try { notes = (await notesFile.text()).trim(); } catch (e) { /* ignore */ }
      }
      if (name) out.push({ type: etype, name, description: body, notes, nestedEntries: nested, source_id, aliases, tags, ...extra, _checked: true });
    }
    const snips = [], chs = [];
    for (const p of byPath.keys()) {
      const low = p.toLowerCase();
      if (!low.endsWith('.md')) continue;
      if (p.endsWith('entry.md') || low.endsWith('/notes.md') || low.endsWith('novel.md')) continue;
      const { fm, body } = parseSimpleFM(await byPath.get(p).text());
      const item = { title: fm.title || '', favourite: fm.favourite === true, body, _checked: true };
      if (low.includes('/snippets/')) {
        snips.push(item);
      } else if (isChatBody(body) || low.includes('/chats/')) {
        chs.push({ ...item, messages: parseChatMsgs(body), file: p.split('/').pop() });
      } else if (!low.includes('/characters/') && !low.includes('/locations/') && !low.includes('/lore/') && !low.includes('/objects/') && !low.includes('/subplots/') && !low.includes('/other/')) {
        snips.push(item);
      }
    }
    log(t('folderSummary', { a: out.length, b: snips.length, c: chs.length }));
    return { codex: out, snippets: snips, chats: chs };
  }

  // ---------- markdown -> NovelCrafter 的 <p> HTML ----------
  function mdToHtml(md) {
    const txt = (md || '').trim();
    if (!txt) return '';
    return txt.split(/\n{2,}/).map((para) => `<p>${esc(para.trim()).replace(/\n/g, '<br>')}</p>`).join('');
  }

  function newId() {
    const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const arr = new Uint8Array(26);
    crypto.getRandomValues(arr);
    return '3' + [...arr].map((b) => abc[b % 62]).join('');
  }

  // ---------- 读：本书权限（写之前预检，免得批量 403） ----------
  async function fetchPermissions(novelId) {
    const input = encodeURIComponent(JSON.stringify({ 0: { json: novelId } }));
    const res = await origFetch(`/api/trpc/novels.getPermissions?batch=1&input=${input}`, { headers: baseHeaders(), credentials: 'include' });
    if (!res.ok) throw new Error(`getPermissions HTTP ${res.status}`);
    const batch = await res.json();
    return batch?.[0]?.result?.data?.json || null;
  }

  // ---------- 读：已有条目索引（跳过重名 + 关联重链用） ----------
  async function fetchExistingIndex(novelId) {
    const input = encodeURIComponent(JSON.stringify({ 0: { json: novelId } }));
    const res = await origFetch(`/api/trpc/data.getAll?batch=1&input=${input}`, { headers: baseHeaders(), credentials: 'include' });
    if (!res.ok) throw new Error(`getAll HTTP ${res.status}`);
    const batch = await res.json();
    const models = batch?.[0]?.result?.data?.json || [];
    const idx = { names: new Set(), nameToId: new Map(), snippetTitles: new Set(), threadTitles: new Set() };
    for (const m of models) {
      if (m.type === 'codexEntries') {
        const nm = m.attributes?.name;
        if (nm) { idx.names.add(nm); if (!idx.nameToId.has(nm)) idx.nameToId.set(nm, m.id); }
      } else if (m.type === 'snippets') {
        const st = (m.attributes?.title || '').trim();
        if (st) idx.snippetTitles.add(st);
      } else if (m.type === 'chatThreads') {
        const ct = (m.attributes?.title || '').trim();
        if (ct) idx.threadTitles.add(ct);
      }
    }
    return idx;
  }

  // ---------- 写：两步（commit 建条目 + updateOne 写详情，与官网行为一致） ----------
  const ID_RE = /^[A-Za-z0-9]{27}$/;
  // 沿用导出时的原始 id：同账号跨书无冲突，还能让关联精确对上；跨账号导入被拒时关掉用随机 id
  function reuseIds() {
    const cb = document.getElementById('nca-reuse');
    return cb ? cb.checked : true;
  }
  function entryId(e) {
    if (reuseIds() && e.source_id && ID_RE.test(e.source_id)) return e.source_id;
    return newId();
  }
  async function createEntry(novelId, userId, e) {
    const id = entryId(e);
    const now = new Date().toISOString();
    const upsert = {
      id, type: 'codexEntries',
      meta: { createdAt: now, updatedAt: now, state: 'active' },
      attributes: {
        type: e.type, name: e.name, description: '', notes: null,
        tags: e.tags || [], aliases: e.aliases || [],
        alwaysInclude: !!e.alwaysInclude, doNotTrack: !!e.doNotTrack, noAutoInclude: !!e.noAutoInclude,
        hideFromAi: false, promptInclusions: null,
        matchExclusions: [], matchCaseSensitive: false, color: e.color ?? null,
      },
      fields: {},
      relationships: { nestedEntries: [], belongsTo: { type: 'novels', id: novelId }, connections: [] },
      links: { thumbnail: null, externalReferences: [] },
    };
    const commitBody = {
      0: {
        json: {
          novelId,
          transaction: { upsert: [upsert] },
          context: [{ event: { timestamp: now, userId, name: 'codex_entry_created', data: {} }, scope: { novelId } }],
        },
        meta: {
          values: {
            'transaction.upsert.0.meta.createdAt': ['Date'],
            'transaction.upsert.0.meta.updatedAt': ['Date'],
            'context.0.event.timestamp': ['Date'],
          },
          referentialEqualities: { 'context.0.event.timestamp': ['transaction.upsert.0.meta.updatedAt'] },
          v: 1,
        },
      },
    };
    let r = await origFetch('/api/trpc/data.commit?batch=1', {
      method: 'POST', headers: baseHeaders(), credentials: 'include', body: JSON.stringify(commitBody),
    });
    if (!r.ok) throw new Error(`commit HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);

    return id;
  }

  // 第二遍：正文 + 研究笔记 + 关联（关联需等全部条目建完、id 落定后才能对上）
  async function pushDetails(novelId, id, e, idSet, nameToId, idToName) {
    const attrs = {};
    const html = mdToHtml(e.description);
    const notesHtml = mdToHtml(e.notes);
    if (html) attrs.description = html;
    if (notesHtml) attrs.notes = notesHtml;
    const refs = [];
    let dropped = 0;
    for (const rid of e.nestedEntries || []) {
      if (idSet.has(rid)) { refs.push(rid); continue; }
      const nm = idToName.get(rid);
      if (nm && nameToId.has(nm)) { refs.push(nameToId.get(nm)); continue; } // 指向被跳过的已有条目，按名重链
      dropped++;
    }
    const hasNested = (e.nestedEntries || []).length > 0;
    if (!Object.keys(attrs).length && !hasNested) return { dropped };
    const model = { type: 'codexEntries', id, meta: { updatedAt: new Date().toISOString() } };
    if (Object.keys(attrs).length) model.attributes = attrs;
    if (hasNested) model.relationships = { nestedEntries: refs };
    const updBody = {
      0: {
        json: { novelId, model, context: null },
        meta: { values: { 'model.meta.updatedAt': ['Date'], context: ['undefined'] }, v: 1 },
      },
    };
    const r = await origFetch('/api/trpc/data.updateOne?batch=1', {
      method: 'POST', headers: baseHeaders(), credentials: 'include', body: JSON.stringify(updBody),
    });
    if (!r.ok) throw new Error(`updateOne HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return { dropped };
  }

  // ---------- 面板 ----------
  function renderAuth() {
    const el = document.getElementById('nca-auth');
    if (el) el.textContent = auth.authorization ? t('authOk', { time: new Date(auth.seenAt).toLocaleTimeString() }) : t('authWait');
    renderSteps();
  }
  function selCount() {
    return entries.filter((e) => e._checked).length + snippets.filter((e) => e._checked).length + chats.filter((e) => e._checked).length;
  }
  function groupHtml(title, arr, kind, rowFn) {
    if (!arr.length) return '';
    const all = arr.every((e) => e._checked);
    const rows = arr.map((e, i) => rowFn(e, i)).join('');
    return `<div style="margin:4px 0"><label style="display:flex;gap:6px;align-items:center;background:#f0f0f0;padding:3px 4px;cursor:pointer;font-weight:bold">
      <input type="checkbox" data-kind="${kind}" data-group="1" ${all ? 'checked' : ''}> ${title}（${arr.filter((e) => e._checked).length}/${arr.length}）</label>${rows}</div>`;
  }
  function renderList() {
    const el = document.getElementById('nca-list');
    if (!el) return;
    el.innerHTML =
      groupHtml('📖 Codex', entries, 'codex', (e, i) =>
        `<label style="display:flex;gap:6px;padding:2px 0 2px 16px;border-bottom:1px solid #eee;cursor:pointer">
          <input type="checkbox" data-kind="codex" data-idx="${i}" ${e._checked ? 'checked' : ''}>
          <span style="flex:1"><b>${escHtml(e.name)}</b> <span style="color:#888">[${escHtml(e.type)}]</span>
          <span style="color:#aaa">${escHtml((e.description || '').slice(0, 30))}…</span></span>
        </label>`) +
      groupHtml('🧩 Snippets', snippets, 'snip', (e, i) =>
        `<label style="display:flex;gap:6px;padding:2px 0 2px 16px;border-bottom:1px solid #eee;cursor:pointer">
          <input type="checkbox" data-kind="snip" data-idx="${i}" ${e._checked ? 'checked' : ''}>
          <span style="flex:1"><b>${escHtml(e.title || t('untitled'))}</b>
          <span style="color:#aaa">${escHtml((e.body || '').slice(0, 30))}…</span></span>
        </label>`) +
      groupHtml('💬 Chats', chats, 'chat', (e, i) =>
        `<label style="display:flex;gap:6px;padding:2px 0 2px 16px;border-bottom:1px solid #eee;cursor:pointer">
          <input type="checkbox" data-kind="chat" data-idx="${i}" ${e._checked ? 'checked' : ''}>
          <span style="flex:1"><b>${escHtml(e.title || e.file || t('untitled'))}</b>
          <span style="color:#888">${t('msgs', { n: (e.messages || []).length })}</span></span>
        </label>`);
    const byKind = { codex: entries, snip: snippets, chat: chats };
    el.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const arr = byKind[cb.dataset.kind];
        if (cb.dataset.group) arr.forEach((e) => (e._checked = cb.checked));
        else arr[+cb.dataset.idx]._checked = cb.checked;
        renderList();
      });
    });
    renderCount();
  }
  function renderCount() {
    const el = document.getElementById('nca-count');
    if (el) el.textContent = t('countLine', {
      a: entries.filter((e) => e._checked).length, b: entries.length,
      c: snippets.filter((e) => e._checked).length, d: snippets.length,
      e: chats.filter((e) => e._checked).length, f: chats.length,
    });
    renderSteps();
  }

  // 顶部步骤条 + 导入按钮就绪门禁
  function renderSteps() {
    const n = selCount();
    const total = entries.length + snippets.length + chats.length;
    const el = document.getElementById('nca-steps');
    if (el) {
      const s1 = auth.authorization ? '✅' : '⬜';
      const s2 = total ? '✅' : '⬜';
      el.textContent = t('steps', { a: s1, b: s2, n });
    }
    const go = document.getElementById('nca-go');
    if (go) {
      go.disabled = !(auth.authorization && n > 0);
      go.style.opacity = go.disabled ? '.45' : '1';
      go.style.cursor = go.disabled ? 'not-allowed' : 'pointer';
    }
  }

  function mount() {
    if (document.getElementById('nca-panel')) return;
    const d = document.createElement('div');
    d.id = 'nca-panel';
    d.style.cssText = 'position:fixed;right:12px;top:12px;width:370px;max-height:92vh;overflow:auto;z-index:999999;background:#fff;border:2px solid #333;border-radius:10px;padding:12px;font-size:13px;color:#222;box-shadow:0 8px 30px rgba(0,0,0,.3)';
    d.innerHTML = `
      <div id="nca-head" style="display:flex;justify-content:space-between;align-items:center;cursor:move;user-select:none"><b>${t('appTitle')}</b><button id="nca-min" title="${t('minTip')}">–</button></div>
      <div id="nca-steps" style="font-size:12px;color:#555;margin:4px 0"></div>
      <div id="nca-body">
        <div id="nca-auth" style="background:#f6f6f6;padding:4px;margin:6px 0;font-size:12px"></div>
        <div style="font-size:12px;color:#555">novelId: <code id="nca-novel"></code><br>userId: <code id="nca-user"></code></div>
        <div style="margin-top:6px"><b>${t('loadStep')}</b><br>
          <input type="file" id="nca-file" accept=".zip,.json" style="display:none">
          <input type="file" id="nca-folder" webkitdirectory style="display:none">
          <div style="display:flex;gap:6px;margin:4px 0">
            <label for="nca-file" style="background:#111;color:#fff;padding:6px 12px;border-radius:6px;cursor:pointer">${t('pickZip')}</label>
            <label for="nca-folder" style="background:#fff;color:#111;padding:6px 12px;border-radius:6px;cursor:pointer;border:1px solid #111">${t('pickFolder')}</label>
          </div>
          <div id="nca-src" style="font-size:12px;color:#666">${t('noSrc')}</div>
          <div style="font-size:12px;color:#666">${t('srcHint')}</div>
          <div id="nca-count"></div>
          <button id="nca-all">${t('selAll')}</button> <button id="nca-none">${t('selNone')}</button>
          <label><input type="checkbox" id="nca-skip" checked> ${t('skipDup')}</label>
          <label title="${t('reuseTip')}"><input type="checkbox" id="nca-reuse"> ${t('reuseId')}</label>
          <div id="nca-list" style="max-height:230px;overflow:auto;border:1px solid #ddd;margin:6px 0;padding:4px"></div>
        </div>
        <div><b>${t('importStep')}</b><br>
          <label>${t('delayMs')} <input id="nca-delay" value="200" style="width:60px;border:2px solid #111;border-radius:6px;padding:4px 6px"> <span style="color:#666">ms</span></label>
          <label><input type="checkbox" id="nca-dry"> ${t('dryRun')}</label><br>
          <button id="nca-go" style="background:#111;color:#fff;padding:6px 12px;border-radius:6px;cursor:pointer;margin-top:4px">${t('goBtn')}</button>
          <span id="nca-prog"></span>
        </div>
        <div><button id="nca-copy">${t('copyBtn')}</button></div>
        <pre id="nca-log" style="background:#111;color:#0f0;height:150px;overflow:auto;font-size:11px;padding:6px;white-space:pre-wrap;user-select:text;cursor:text"></pre>
      </div>`;
    document.body.appendChild(d);
    // ---------- 面板/小圆点：拖动 + 最小化 ----------
    const POS_PANEL = 'nca-pos-panel', POS_DOT = 'nca-pos-dot';
    const readPos = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
    const writePos = (k, el) => { try { localStorage.setItem(k, JSON.stringify({ left: el.style.left, top: el.style.top })); } catch (e) {} };
    function applyPos(el, pos) {
      if (pos && pos.left) { el.style.left = pos.left; el.style.top = pos.top; el.style.right = 'auto'; el.style.bottom = 'auto'; }
    }
    function makeDraggable(el, handle, posKey, onTap) {
      handle.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        if (ev.target.closest && ev.target.closest('#nca-min')) return; // 点最小化按钮不触发拖动
        const r = el.getBoundingClientRect();
        el.style.left = r.left + 'px'; el.style.top = r.top + 'px';
        el.style.right = 'auto'; el.style.bottom = 'auto';
        const ox = ev.clientX - r.left, oy = ev.clientY - r.top;
        const sx = ev.clientX, sy = ev.clientY;
        let moved = false;
        const move = (me) => {
          if (Math.abs(me.clientX - sx) + Math.abs(me.clientY - sy) > 4) moved = true;
          el.style.left = (me.clientX - ox) + 'px'; el.style.top = (me.clientY - oy) + 'px';
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          writePos(posKey, el);
          if (!moved && onTap) onTap();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        ev.preventDefault();
      });
    }
    let dot = document.getElementById('nca-dot');
    if (!dot) {
      dot = document.createElement('div');
      dot.id = 'nca-dot';
      dot.textContent = '📚';
      dot.title = t('dotTip');
      dot.style.cssText = 'position:fixed;z-index:999999;width:42px;height:42px;border-radius:50%;background:#111;color:#fff;display:none;align-items:center;justify-content:center;font-size:22px;cursor:move;box-shadow:0 4px 16px rgba(0,0,0,.35);user-select:none;right:12px;bottom:12px;';
      document.body.appendChild(dot);
    }
    applyPos(d, readPos(POS_PANEL));
    applyPos(dot, readPos(POS_DOT));
    makeDraggable(d, document.getElementById('nca-head'), POS_PANEL);
    makeDraggable(dot, dot, POS_DOT, () => { dot.style.display = 'none'; d.style.display = ''; });
    document.getElementById('nca-min').onclick = () => { d.style.display = 'none'; dot.style.display = 'flex'; };
    document.getElementById('nca-novel').textContent = detectNovelId() || t('notDetected');
    document.getElementById('nca-user').textContent = detectUserId() || t('userRetry');
    renderAuth(); renderList();

    document.getElementById('nca-all').onclick = () => { [entries, snippets, chats].forEach((a) => a.forEach((e) => (e._checked = true))); renderList(); };
    document.getElementById('nca-none').onclick = () => { [entries, snippets, chats].forEach((a) => a.forEach((e) => (e._checked = false))); renderList(); };
    document.getElementById('nca-file').addEventListener('change', async (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      document.getElementById('nca-src').textContent = t('srcPicked', { f: f.name });
      try {
        const mark = (a) => (a || []).map((e) => ({ ...e, _checked: true }));
        if (f.name.endsWith('.zip')) {
          const r = await loadZip(f);
          entries = mark(r.codex); snippets = mark(r.snippets); chats = mark(r.chats);
        } else {
          const j = await f.text().then(JSON.parse);
          if (Array.isArray(j)) { entries = mark(j); snippets = []; chats = []; } // 老格式：纯 codex 数组
          else { entries = mark(j.codex); snippets = mark(j.snippets); chats = mark(j.chats); }
        }
        log(t('loaded', { a: entries.length, b: snippets.length, c: chats.length, f: f.name }));
        renderList();
      } catch (err) { log(t('loadFail', { e: err.message })); }
    });
    document.getElementById('nca-folder').addEventListener('change', async (ev) => {
      const files = [...ev.target.files];
      if (!files.length) return;
      document.getElementById('nca-src').textContent = t('srcFolder', { f: (files[0].webkitRelativePath || '').split('/')[0] || '?', n: files.length });
      try {
        const r = await loadFileList(files);
        const mark = (a) => (a || []).map((e) => ({ ...e, _checked: true }));
        entries = mark(r.codex); snippets = mark(r.snippets); chats = mark(r.chats);
        log(t('loadedFolder', { a: entries.length, b: snippets.length, c: chats.length }));
        renderList();
      } catch (err) { log(t('loadFail', { e: err.message })); }
    });
    document.getElementById('nca-copy').onclick = async () => {
      const text = logLines.join('\n') || t('emptyLog');
      try { await navigator.clipboard.writeText(text); }
      catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e2) { /*  fallback 下方 */ }
        ta.remove();
      }
      log(t('copied'));
    };
    document.getElementById('nca-go').onclick = async () => {
      const novelId = detectNovelId();
      if (!novelId) { alert(t('alertNovel')); return; }
      if (!auth.authorization) { alert(t('alertAuth')); return; }
      let userId = detectUserId();
      if (!userId) { userId = prompt(t('promptUser')); if (!userId) return; }
      const todo = entries.filter((e) => e._checked);
      const todoSnip = snippets.filter((e) => e._checked);
      const todoChat = chats.filter((e) => e._checked);
      if (!todo.length && !todoSnip.length && !todoChat.length) { alert(t('alertEmpty')); return; }
      const skip = document.getElementById('nca-skip').checked;
      const delay = +document.getElementById('nca-delay').value || 800;
      if (document.getElementById('nca-dry').checked) {
        log(t('drySummary', { a: todo.length, b: todoSnip.length, c: todoChat.length, n: novelId }));
        todo.slice(0, 3).forEach((e) => log(t('dryEntry', { name: e.name, type: e.type, id: entryId(e), notes: e.notes ? t('y') : t('n'), rel: (e.nestedEntries || []).length }) + '\n' + mdToHtml(e.description).slice(0, 300)));
        todoSnip.slice(0, 3).forEach((s) => log(t('drySnip', { t: s.title || t('untitled'), f: !!s.favourite }) + '\n' + JSON.stringify(textToDoc(s.body)).slice(0, 300)));
        todoChat.slice(0, 3).forEach((c) => log(t('dryChat', { t: c.title || c.file || '', n: c.messages.length, m: (c.messages || []).map((m) => m.type).join(',') })));
        return;
      }
      let idx = { names: new Set(), nameToId: new Map(), snippetTitles: new Set(), threadTitles: new Set() };
      let haveServerList = false;
      try {
        const perm = await fetchPermissions(novelId);
        log(t('permLine', { r: perm?.role, w: perm?.canWrite }));
        if (perm && perm.canWrite === false) {
          log(t('noPerm'));
          alert(t('alertPerm'));
          return;
        }
      } catch (err) { log(t('permFail', { e: err.message })); }
      if (skip) {
        try { idx = await fetchExistingIndex(novelId); haveServerList = true; log(t('existCount', { n: idx.names.size })); }
        catch (err) { log(t('readFail', { e: err.message })); }
      }
      // 注意：面板本身列着所有名字，比对时必须先藏起面板，否则全被判重名
      function pageTextWithoutPanel() {
        const p = document.getElementById('nca-panel');
        if (!p) return document.body.innerText;
        const prev = p.style.display;
        p.style.display = 'none';
        const txt = document.body.innerText;
        p.style.display = prev;
        return txt;
      }
      let pageT = null;
      const idToName = new Map();
      for (const e of todo) if (e.source_id) idToName.set(e.source_id, e.name);
      // 第一遍：建条目（id 落定）
      const created = [];
      let ok = 0, fail = 0, skipped = 0;
      for (let i = 0; i < todo.length; i++) {
        const e = todo[i];
        document.getElementById('nca-prog').textContent = t('progBuild', { a: i + 1, b: todo.length });
        let dup = idx.names.has(e.name);
        if (!dup && !haveServerList) {
          if (pageT === null) pageT = pageTextWithoutPanel();
          dup = pageT.includes(e.name);
        }
        if (skip && dup) { log(t('skipName', { n: e.name })); skipped++; continue; }
        try {
          const id = await createEntry(novelId, userId, e);
          created.push({ e, id });
          if (!idx.nameToId.has(e.name)) idx.nameToId.set(e.name, id);
          ok++; log(`✓ [${i + 1}/${todo.length}] ${e.name} [${e.type}]`);
        }
        catch (err) {
          fail++;
          const hint = (String(err.message).includes('403') && reuseIds()) ? t('hint403') : '';
          log(`✗ [${i + 1}/${todo.length}] ${e.name}: ${err.message}${hint}`);
        }
        await sleep(delay + Math.random() * 400);
      }
      // 第二遍：正文 + 研究笔记 + 关联
      const idSet = new Set(created.map((c) => c.id));
      let relDropped = 0;
      for (let i = 0; i < created.length; i++) {
        const { e, id } = created[i];
        document.getElementById('nca-prog').textContent = t('progDetail', { a: i + 1, b: created.length });
        try {
          const r = await pushDetails(novelId, id, e, idSet, idx.nameToId, idToName);
          relDropped += r.dropped;
        }
          catch (err) { fail++; log(t('failDetail', { n: e.name, e: err.message })); }
        await sleep(400 + Math.random() * 300);
      }
      // ---- 片段 ----
      if (todoSnip.length) {
        log(t('phaseSnip', { n: todoSnip.length }));
        for (let i = 0; i < todoSnip.length; i++) {
          const s = todoSnip[i];
          document.getElementById('nca-prog').textContent = t('progSnip', { a: i + 1, b: todoSnip.length });
          const st = (s.title || '').trim();
          if (skip && st && idx.snippetTitles.has(st)) { log(t('skipSnip', { n: st })); skipped++; continue; }
          try {
            await commitRecords(novelId, userId, [{
              id: newId(), type: 'snippets',
              attributes: { title: s.title || '', favourite: !!s.favourite, content: textToDoc(s.body) },
              relationships: { belongsTo: { type: 'novels', id: novelId } },
              links: {},
            }], 'snippet_created');
            ok++; log(t('okSnip', { a: i + 1, b: todoSnip.length, n: s.title || t('untitled') }));
          } catch (err) { fail++; log(t('failSnip', { n: s.title || t('untitled'), e: err.message })); }
          await sleep(delay + Math.random() * 400);
        }
      }
      // ---- 对话：先消息，后线程 ----
      if (todoChat.length) {
        log(t('phaseChat', { n: todoChat.length }));
        for (let i = 0; i < todoChat.length; i++) {
          const c = todoChat[i];
          document.getElementById('nca-prog').textContent = t('progChat', { a: i + 1, b: todoChat.length });
          const ct = (c.title || '').trim();
          if (skip && ct && idx.threadTitles.has(ct)) { log(t('skipThread', { n: ct })); skipped++; continue; }
          if (!c.messages.length) { log(t('skipEmpty', { n: c.file || ct || t('untitled') })); skipped++; continue; }
          try {
            const msgRecs = c.messages.map((m) => ({
              id: newId(), type: 'chatMessages',
              attributes: { type: m.type, text: m.text, model: null },
              relationships: {}, links: {},
            }));
            await commitRecords(novelId, userId, msgRecs, 'chat_message_created');
            await commitRecords(novelId, userId, [{
              id: newId(), type: 'chatThreads',
              attributes: {
                title: c.title || '', favourite: !!c.favourite,
                includeOutlineInContext: false, includeAllTextInContext: false,
                inputs: {}, memoryCutoff: 14, thinking: null,
              },
              relationships: { messages: msgRecs.map((m) => m.id), prompt: null, model: null, sceneContext: null },
              links: {},
            }], 'chat_thread_created');
            ok++; log(t('okChat', { a: i + 1, b: todoChat.length, n: c.title || c.file || '', m: msgRecs.length }));
          } catch (err) { fail++; log(t('failChat', { n: c.title || c.file || '', e: err.message })); }
          await sleep(delay + Math.random() * 400);
        }
      }
      log(t('done', { ok, fail, skip: skipped, rel: relDropped }));
    };
    log(t('ready'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
