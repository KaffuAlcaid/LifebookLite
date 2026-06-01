# 月度生活费账本

本地单人使用的记账小工具。Flask 当 JSON API，前端单页（原生 JS + fetch），数据存本地 JSON。

## 请注意  

>  **项目定位**：本项目为**纯自用**的本地客制化小工具。
> 代码架构与前端 UI 完全基于个人审美与日常习惯定制（Vibe Coding 产物），本人仅进行脑洞和Prompt Engineering。
> **不保证通用性，不接受任何 Feature Request 或适配提议**。欢迎搬砖，谢绝提意见。

## 运行

```bash
pip install -r requirements.txt
python app.py
```

浏览器打开 http://127.0.0.1:5000

> Windows 若报时区找不到，执行 `pip install tzdata` 即可。
> 饼图库 Chart.js 走 CDN，首次加载需联网；之后浏览器会缓存。完全离线可把
> https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js 下载到 static/ 并改 index.html 的引用。

## 文件职责

| 文件 | 作用 |
|------|------|
| `app.py` | Flask 路由，只做转发 |
| `timeutil.py` | 北京时间（本地时区 Asia/Shanghai） |
| `storage.py` | 账本读写 + 备份 |
| `stats.py` | 月度/季度收支与消费类型聚合 |
| `templates/index.html` | 页面结构 |
| `static/style.css` | 暖色低对比主题 |
| `static/app.js` | 全部交互 |
| `data/ledger.json` | 当前账本（运行后自动生成） |
| `data/backups/` | 历次写入前的快照 |

## 关键设计

- **写入才落盘**：新增/编辑/删除都先在浏览器内存里改，顶栏出现“● 有未写入的改动”，
  点【写入】才真正存盘。刷新或关页面会丢未写入内容（关页面会弹浏览器提醒）。
- **备份**：每次写入前，把磁盘上旧的 `ledger.json` 复制进 `backups/`（带时间戳）。
  所以备份永远是“上一个已保存版本”，是整账本快照，不是每条一份。
  - 清除老备份：保留最新 3 份。
  - 清空备份：弹窗确认后全删。
- **新增月份**：会继承最近一个月的生活费与固定支出（每月通常相同），条目清空。
- **统计实时**：前端把内存账本 POST 给 `/api/stats`，由 `stats.py` 算好返回，
  含未写入的改动也会即时反映。
- **季度**：自然季度（Q1=1–3月…），季度视图聚合该季所有月份，仅查看；
  编辑/删除请回月度视图。

## 数据结构（data/ledger.json）

```json
{
  "meta": { "updated": "2026/05/31" },
  "months": {
    "2026/05": {
      "allowance": 2000,
      "fixed": [{ "name": "房租", "amount": 800, "type": "居住" }],
      "entries": [
        { "id": "e_...", "date": "2026/05/31", "amount": 35.5, "type": "餐饮", "content": "午饭" }
      ]
    }
  }
}
```

收入=生活费；支出=固定支出合计+记账合计；结余=收−支。固定支出也带类型，会并入消费类型饼图。
