"""统计：从账本聚合出月度 / 季度的收支与消费类型分布

约定：
    收入 income = 当月生活费 allowance（写死的计划值，无收入条目）
    支出 expense = 固定支出合计 + 记账条目合计
    结余 balance = income - expense
    消费类型分布 by_type = 固定支出 + 记账条目 按 type 求和（用于饼图）

月份键格式 "YYYY/MM"；季度键格式 "YYYY/Qn"（n=1..4，自然季度）。
"""

from collections import defaultdict

EXPENSE_TYPES = [
    "教育", "餐饮", "娱乐", "交通", "购物",
    "居住", "医疗", "通讯", "人情社交", "其他",
]


def _blank_summary() -> dict:
    return {
        "income": 0.0,
        "expense": 0.0,
        "balance": 0.0,
        "fixed_total": 0.0,
        "entries_total": 0.0,
        "by_type": {t: 0.0 for t in EXPENSE_TYPES},
    }


def _accumulate(summary: dict, month_obj: dict) -> None:
    summary["income"] += float(month_obj.get("allowance", 0) or 0)

    for item in month_obj.get("fixed", []):
        amt = float(item.get("amount", 0) or 0)
        t = item.get("type", "其他")
        summary["fixed_total"] += amt
        summary["by_type"][t] = summary["by_type"].get(t, 0.0) + amt

    for e in month_obj.get("entries", []):
        amt = float(e.get("amount", 0) or 0)
        t = e.get("type", "其他")
        summary["entries_total"] += amt
        summary["by_type"][t] = summary["by_type"].get(t, 0.0) + amt


def _finalize(summary: dict) -> dict:
    summary["expense"] = round(summary["fixed_total"] + summary["entries_total"], 2)
    summary["income"] = round(summary["income"], 2)
    summary["balance"] = round(summary["income"] - summary["expense"], 2)
    summary["fixed_total"] = round(summary["fixed_total"], 2)
    summary["entries_total"] = round(summary["entries_total"], 2)
    summary["by_type"] = {k: round(v, 2) for k, v in summary["by_type"].items()}
    return summary


def month_summary(month_obj: dict) -> dict:
    s = _blank_summary()
    _accumulate(s, month_obj)
    return _finalize(s)


def _quarter_of(mm: int) -> int:
    return (mm - 1) // 3 + 1


def compute(ledger: dict) -> dict:
    months_out = {}
    quarter_acc = defaultdict(_blank_summary)

    for key, month_obj in ledger.get("months", {}).items():
        months_out[key] = month_summary(month_obj)
        # 季度累加
        try:
            year, mm = key.split("/")
            qkey = f"{year}/Q{_quarter_of(int(mm))}"
            _accumulate(quarter_acc[qkey], month_obj)
        except (ValueError, KeyError):
            continue

    quarters_out = {k: _finalize(v) for k, v in quarter_acc.items()}
    return {"months": months_out, "quarters": quarters_out, "types": EXPENSE_TYPES}
