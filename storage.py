"""存储与备份：负责账本 JSON 的读写，以及备份管理。

文件布局（全部在本文件所在目录下的 data/ 里）：
    data/
        ledger.json              当前账本（唯一真相 single source of truth）
        backups/
            ledger_YYYYMMDD_HHMMSS.json   每次“写入”前对旧账本的快照

备份策略：
    - 点“写入”时，先把磁盘上现有的 ledger.json 复制进 backups/（带时间戳），
      再把新内容覆盖写入 ledger.json。
      因此 backups/ 里永远是“上一个已保存版本”，可回滚。
    - 备份是【整个账本文件】的快照，不是每条账目一份。
    - 清除老备份：按文件时间排序，仅保留最新 N 份（默认 3）。
    - 清空备份：删除 backups/ 下全部文件（前端会先弹窗确认）。
"""

import json
import shutil
from pathlib import Path

from timeutil import today_str

# 以本文件所在位置为基准定位 data 目录，换机器/换工作目录都不会错
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
BACKUP_DIR = DATA_DIR / "backups"
LEDGER_PATH = DATA_DIR / "ledger.json"

KEEP_BACKUPS = 3  # 清除老备份时保留的份数

# 全新账本的初始结构
_EMPTY_LEDGER = {"meta": {"updated": ""}, "months": {}}


def _ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def load_ledger() -> dict:

    _ensure_dirs()
    if not LEDGER_PATH.exists():
        return json.loads(json.dumps(_EMPTY_LEDGER))  # 深拷贝
    try:
        with LEDGER_PATH.open(encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        # 账本被手改坏时，给出具体位置，由全局 handler 转成 JSON 错误返回前端
        raise ValueError(
            f"账本文件 ledger.json 损坏，无法解析（第 {e.lineno} 行 第 {e.colno} 列）。"
            f"可从 data/backups/ 里挑一份好的备份覆盖回去。"
        ) from e


def _backup_existing() -> str | None:

    if not LEDGER_PATH.exists():
        return None
    from timeutil import beijing_now

    stamp = beijing_now().strftime("%Y%m%d_%H%M%S")
    name = f"ledger_{stamp}.json"
    shutil.copy2(LEDGER_PATH, BACKUP_DIR / name)
    return name


def save_ledger(ledger: dict) -> dict:

    _ensure_dirs()
    backup_name = _backup_existing()

    ledger.setdefault("meta", {})["updated"] = today_str()

    tmp = LEDGER_PATH.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(ledger, f, ensure_ascii=False, indent=2)
    tmp.replace(LEDGER_PATH)
    return {"backup": backup_name}


def list_backups() -> list[dict]:

    _ensure_dirs()
    items = []
    for p in BACKUP_DIR.glob("ledger_*.json"):
        items.append({"name": p.name, "mtime": p.stat().st_mtime})
    items.sort(key=lambda x: x["mtime"], reverse=True)
    return items


def prune_backups(keep: int = KEEP_BACKUPS) -> int:

    backups = list_backups()
    to_delete = backups[keep:]
    for b in to_delete:
        (BACKUP_DIR / b["name"]).unlink(missing_ok=True)
    return len(to_delete)


def clear_backups() -> int:

    backups = list_backups()
    for b in backups:
        (BACKUP_DIR / b["name"]).unlink(missing_ok=True)
    return len(backups)
