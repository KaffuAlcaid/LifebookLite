"""时间工具：基于本地时区计算北京时间。

设计说明：
    需求里写的是“爬取北京时间”，但本地机器（Linux）系统时间通常已校准，
    直接用 Asia/Shanghai 时区即可得到北京时间，无需联网。
    若日后想防止系统时间被篡改，可在 beijing_now() 内改为请求网络时间 API，
    其余代码不用动（这就是把它单独成模块的好处）。
"""

from datetime import datetime
from zoneinfo import ZoneInfo

# 整个北京 / 中国大陆都用这一个时区
_BJ = ZoneInfo("Asia/Shanghai")


def beijing_now() -> datetime:
    """返回带时区的北京当前时间。"""
    return datetime.now(_BJ)


def today_str() -> str:
    """北京当天日期，格式 YYYY/MM/DD。"""
    return beijing_now().strftime("%Y/%m/%d")


def month_key() -> str:
    """北京当前月份键，格式 YYYY/MM。"""
    return beijing_now().strftime("%Y/%m")
