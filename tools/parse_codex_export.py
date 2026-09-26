"""
NovelCrafter 官方 Codex 导出包 -> 通用导入 JSON 转换器
用法:
  python parse_codex_export.py "2026-09-14 01-07-35 test - codex.zip"
  python parse_codex_export.py "2026-09-14 01-07-35 test - codex"   # 已解压的文件夹也行
  python parse_codex_export.py export.zip -o codex_import.json

输出 JSON 格式 (给油猴脚本用):
[
  {
    "type": "character|location|lore|object|subplot|other",
    "name": "...",
    "description": "markdown 正文",
    "aliases": [...],
    "tags": [...],
    "notes": "研究笔记纯文本(notes.md,如有)",
    "nestedEntries": ["关联条目的原始id..."],
    "alwaysIncludeInContext": false,
    "doNotTrack": false,
    "noAutoInclude": false,
    "color": null,
    "source_id": "原导出id(仅参考,导入时会重新生成)"
  }
]
"""
import argparse
import json
import sys
import zipfile
from pathlib import Path


def parse_frontmatter(md_text: str):
    """极简 frontmatter 解析,只取我们关心的字段,避免依赖 pyyaml"""
    if not md_text.startswith("---"):
        return {}, md_text
    parts = md_text.split("---", 2)
    if len(parts) < 3:
        return {}, md_text
    _, fm_raw, body = parts
    meta = {}
    current_key = None
    for line in fm_raw.splitlines():
        if not line.strip():
            continue
        # list item, e.g. "  - xxx"
        s = line.strip()
        if s.startswith("- "):
            val = s[2:].strip()
            if current_key and isinstance(meta.get(current_key), list):
                meta[current_key].append(val)
            continue
        if ":" in line:
            k, v = line.split(":", 1)
            k = k.strip()
            v = v.strip()
            if v == "":
                # 可能是空list或下行是list,先按list占位
                # 看下一行?简化: aliases/tags 默认为 list
                if k in ("aliases", "tags"):
                    meta[k] = []
                else:
                    meta[k] = ""
                current_key = k
            elif v == "[]":
                meta[k] = []
                current_key = k
            elif v == "{}":
                meta[k] = {}
                current_key = None
            elif v == "null":
                meta[k] = None
                current_key = None
            elif v in ("true", "false"):
                meta[k] = (v == "true")
                current_key = None
            else:
                meta[k] = v
                current_key = None
    return meta, body.strip()


def load_one_entry(entry_md: Path, metadata_json: Path | None):
    md_text = entry_md.read_text(encoding="utf-8")
    fm, body = parse_frontmatter(md_text)

    name = fm.get("name", "")
    etype = fm.get("type", "other")
    aliases = fm.get("aliases", [])
    tags = fm.get("tags", [])

    source_id = None
    nested = []
    notes_file = entry_md.parent / "notes.md"
    notes = notes_file.read_text(encoding="utf-8").strip() if notes_file.exists() else ""
    if metadata_json and metadata_json.exists():
        try:
            mj = json.loads(metadata_json.read_text(encoding="utf-8"))
            attrs = mj.get("attributes", {})
            # metadata.json 更权威,用它覆盖 frontmatter
            name = attrs.get("name", name)
            etype = attrs.get("type", etype)
            aliases = attrs.get("aliases", aliases)
            tags = attrs.get("tags", tags)
            source_id = mj.get("id")
            nested = mj.get("relationships", {}).get("nestedEntries", []) or []
            extra = {
                "color": attrs.get("color"),
                "alwaysIncludeInContext": attrs.get("alwaysIncludeInContext", False),
                "doNotTrack": attrs.get("doNotTrack", False),
                "noAutoInclude": attrs.get("noAutoInclude", False),
            }
        except Exception as e:
            print(f"[warn] metadata 解析失败 {metadata_json}: {e}", file=sys.stderr)
            extra = {
                "color": fm.get("color"),
                "alwaysIncludeInContext": fm.get("alwaysIncludeInContext", False),
                "doNotTrack": fm.get("doNotTrack", False),
                "noAutoInclude": fm.get("noAutoInclude", False),
            }
    else:
        extra = {
            "color": fm.get("color"),
            "alwaysIncludeInContext": fm.get("alwaysIncludeInContext", False),
            "doNotTrack": fm.get("doNotTrack", False),
            "noAutoInclude": fm.get("noAutoInclude", False),
        }

    # 类型归一化: 官方导出用 characters/locations 文件夹,单数化
    type_map = {
        "characters": "character",
        "character": "character",
        "locations": "location",
        "location": "location",
        "lore": "lore",
        "objects": "object",
        "object": "object",
        "items": "object",
        "item": "object",
        "subplot": "subplot",
        "subplots": "subplot",
        "other": "other",
    }
    etype = type_map.get(str(etype).lower(), "other")

    return {
        "type": etype,
        "name": name,
        "description": body,
        "notes": notes,
        "nestedEntries": nested,
        "aliases": aliases or [],
        "tags": tags or [],
        "alwaysIncludeInContext": bool(extra.get("alwaysIncludeInContext", False)),
        "doNotTrack": bool(extra.get("doNotTrack", False)),
        "noAutoInclude": bool(extra.get("noAutoInclude", False)),
        "color": extra.get("color"),
        "source_id": source_id,
    }


def collect_from_dir(root: Path):
    entries = []
    # 官方结构: <root>/{characters,locations,lore,objects,other,...}/*/{entry.md,metadata.json}
    for entry_md in sorted(root.rglob("entry.md")):
        mj = entry_md.parent / "metadata.json"
        try:
            e = load_one_entry(entry_md, mj if mj.exists() else None)
            if not e["name"]:
                print(f"[skip] 空名字: {entry_md}", file=sys.stderr)
                continue
            entries.append(e)
        except Exception as ex:
            print(f"[skip] 解析失败 {entry_md}: {ex}", file=sys.stderr)
    return entries


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input", help="导出 zip 或已解压文件夹")
    ap.add_argument("-o", "--output", default="codex_import.json")
    args = ap.parse_args()

    inp = Path(args.input)
    if inp.suffix.lower() == ".zip" and inp.is_file():
        import tempfile
        tmp = Path(tempfile.mkdtemp(prefix="nc_codex_"))
        with zipfile.ZipFile(inp, "r") as z:
            z.extractall(tmp)
        # zip 里通常包一层文件夹
        candidates = [p for p in tmp.iterdir() if p.is_dir()]
        root = candidates[0] if len(candidates) == 1 else tmp
        entries = collect_from_dir(root)
    elif inp.is_dir():
        entries = collect_from_dir(inp)
    else:
        print(f"找不到输入: {inp}", file=sys.stderr)
        sys.exit(1)

    out = Path(args.output)
    out.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"共 {len(entries)} 条,已写入 {out}")
    # 类型统计
    from collections import Counter
    print(Counter(e["type"] for e in entries))


if __name__ == "__main__":
    main()
