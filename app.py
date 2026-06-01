"""Flask 入口：只做路由，把活儿分给 storage/stats/timeutil

运行：
    pip install -r requirements.txt
    python app.py
    浏览器打开 http://127.0.0.1:5000

API 一览：
    GET  /                  页面
    GET  /api/today         北京当天日期 {date: "YYYY/MM/DD"}
    GET  /api/ledger        读取当前已保存账本
    POST /api/ledger        写入账本（写入前自动备份旧版本）—— 对应“写入”按钮
    POST /api/stats         传入内存账本，返回月度/季度统计（实时，含未保存改动）
    GET  /api/backups       列出备份
    POST /api/backups/prune 清除老备份（保留最新 3 份）
    POST /api/backups/clear 清空全部备份
"""

import logging

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

import stats
import storage
from timeutil import today_str

app = Flask(__name__)
app.json.ensure_ascii = False   # 返回 JSON 里的中文不转义成 \uXXXX
log = logging.getLogger("lifebook")

@app.errorhandler(HTTPException)
def handle_http_exception(e):
    return jsonify({"error": e.description or e.name}), e.code


@app.errorhandler(Exception)
def handle_uncaught(e):
    log.exception("未捕获异常")
    return jsonify({"error": f"服务器内部错误：{e}"}), 500


def _json_body():

    data = request.get_json(silent=True)
    if data is None:
        from flask import abort
        abort(400, description="请求不是合法 JSON")
    return data


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/today")
def api_today():
    try:
        return jsonify({"date": today_str()})
    except Exception as e:
        log.exception("获取北京时间失败")
        return jsonify({"error": f"获取北京时间失败：{e}"}), 500


@app.get("/api/ledger")
def api_get_ledger():
    try:
        return jsonify(storage.load_ledger())
    except ValueError as e:
        log.warning("账本损坏：%s", e)
        return jsonify({"error": str(e)}), 400


@app.post("/api/ledger")
def api_save_ledger():
    ledger = _json_body()
    if not isinstance(ledger, dict) or "months" not in ledger:
        return jsonify({"error": "账本格式不正确：缺少 months 字段"}), 400
    try:
        result = storage.save_ledger(ledger)
    except OSError as e:
        log.exception("写入磁盘失败")
        return jsonify({"error": f"写入磁盘失败：{e}"}), 500
    return jsonify({"ok": True, "backup": result["backup"], "updated": today_str()})


@app.post("/api/stats")
def api_stats():
    ledger = _json_body()
    if not isinstance(ledger, dict):
        return jsonify({"error": "账本格式不正确：应为 JSON 对象"}), 400
    try:
        return jsonify(stats.compute(ledger))
    except (KeyError, TypeError, ValueError, AttributeError) as e:
        log.warning("统计失败，数据结构异常：%s", e)
        return jsonify({"error": f"统计失败，账本数据结构异常：{e}"}), 400


@app.get("/api/backups")
def api_list_backups():
    try:
        return jsonify({"backups": storage.list_backups()})
    except OSError as e:
        log.exception("列出备份失败")
        return jsonify({"error": f"列出备份失败：{e}"}), 500


@app.post("/api/backups/prune")
def api_prune_backups():
    try:
        deleted = storage.prune_backups()
    except OSError as e:
        log.exception("清除老备份失败")
        return jsonify({"error": f"清除老备份失败：{e}"}), 500
    return jsonify({"ok": True, "deleted": deleted, "kept": storage.KEEP_BACKUPS})


@app.post("/api/backups/clear")
def api_clear_backups():
    try:
        deleted = storage.clear_backups()
    except OSError as e:
        log.exception("清空备份失败")
        return jsonify({"error": f"清空备份失败：{e}"}), 500
    return jsonify({"ok": True, "deleted": deleted})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
