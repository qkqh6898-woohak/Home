#!/usr/bin/env python3
"""매일 실행되어 app/data/data.json 을 만든다.

- API 키가 없으면 샘플 데이터로 동작한다 (화면에 "샘플"로 표시).
- 환경 변수 ECOS_KEY, DATA_GO_KR_KEY 가 있으면 해당 지표를 실제 데이터로 바꾼다.
  실제 수집 코드는 키 없이 작성되어 아직 실행 확인을 하지 못했다 (미검증).
- 뉴스는 키가 필요 없는 RSS로 수집한다.
표준 라이브러리만 사용한다.
"""
import datetime as dt
import json
import math
import os
import random
import statistics
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "data" / "data.json"
KST = dt.timezone(dt.timedelta(hours=9))
DEADLINE = dt.date(2030, 8, 1)          # 사택 만료 (2030년 8월)
BUDGET = (6.0, 10.0)                    # 예산 (억 원)
EPOCH = (2023, 1)                       # 샘플 데이터 시작 월
WINDOW = 36                             # 화면에 보여줄 개월 수

REGIONS = [
    {"id": "doryong", "name": "도룡", "area": "유성구 도룡동", "commute": 10,
     "gu": "30200", "dongs": ["도룡동"], "base": 10.4, "vol": 18, "jeonse": 55},
    {"id": "jeonmin", "name": "전민·관평", "area": "유성구 전민동·관평동", "commute": 15,
     "gu": "30200", "dongs": ["전민동", "관평동", "문지동"], "base": 5.6, "vol": 55, "jeonse": 68},
    {"id": "noeun", "name": "노은·지족", "area": "유성구 노은동·지족동", "commute": 20,
     "gu": "30200", "dongs": ["노은동", "지족동", "하기동", "반석동"], "base": 6.3, "vol": 70, "jeonse": 66},
    {"id": "jukdong", "name": "죽동·봉명", "area": "유성구 죽동·봉명동", "commute": 20,
     "gu": "30200", "dongs": ["죽동", "봉명동", "장대동"], "base": 7.4, "vol": 40, "jeonse": 62},
    {"id": "dunsan", "name": "둔산·월평", "area": "서구 둔산동·월평동·만년동", "commute": 25,
     "gu": "30170", "dongs": ["둔산동", "월평동", "만년동"], "base": 7.0, "vol": 95, "jeonse": 60},
    {"id": "doan", "name": "도안", "area": "유성구·서구 도안신도시", "commute": 30,
     "gu": "30200", "dongs": ["원신흥동", "상대동", "용계동", "도안동"], "base": 8.3, "vol": 80, "jeonse": 58},
]


# ---------------------------------------------------------------- 공통 도구
def months_between(start, end):
    y, m = start
    out = []
    while (y, m) <= end:
        out.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def ym_label(ym):
    return f"{ym[0]}-{ym[1]:02d}"


def piece(x, pts):
    """구간별 직선 보간. pts = [(x0, y0), (x1, y1), ...]"""
    if x <= pts[0][0]:
        return pts[0][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return pts[-1][1]


def pct_change(a, b):
    return (a / b - 1) * 100 if b else 0.0


def log(msg):
    print(msg, file=sys.stderr)


# ---------------------------------------------------------------- 샘플 데이터
def walk(key, n, sigma, phi=0.85):
    """월마다 같은 값이 나오는 AR(1) 잡음. 날짜가 지나도 과거 값은 바뀌지 않는다."""
    out, v = [], 0.0
    for i in range(n):
        v = phi * v + random.Random(f"{key}:{i}").gauss(0, sigma)
        out.append(v)
    return out


def sample_city(n):
    t = range(n)
    n_rate = walk("rate", n, 0.05)
    n_del = walk("delinq", n, 0.008)
    n_auc = walk("auction", n, 6)
    n_bid = walk("bid", n, 1.2)
    n_uns = walk("unsold", n, 90)
    base_steps = [3.5, 3.5, 3.5, 3.25, 3.0, 2.75, 2.5, 2.5, 2.5, 2.5]
    return {
        "mortgage_rate": [round(4.75 - 0.75 * (1 - math.exp(-i / 22)) + n_rate[i], 2) for i in t],
        "base_rate": [base_steps[min(i // 5, len(base_steps) - 1)] for i in t],
        "delinquency": [round(0.24 + 0.004 * i + n_del[i], 3) for i in t],
        "auction_count": [max(20, round(62 + 1.1 * i + 10 * math.sin(i / 5) + n_auc[i])) for i in t],
        "auction_bid_ratio": [round(84 - 4 * math.sin((i + 4) / 9) + n_bid[i], 1) for i in t],
        "unsold": [max(300, round(1500 + 500 * math.sin((i - 6) / 8) + n_uns[i])) for i in t],
    }


def sample_region(r, n):
    n_p = walk(f"price:{r['id']}", n, 0.007)
    n_v = walk(f"vol:{r['id']}", n, 0.10, phi=0.6)
    n_j = walk(f"jeonse:{r['id']}", n, 0.5)
    phase = sum(map(ord, r["id"])) % 7
    price, volume, jeonse = [], [], []
    for i in range(n):
        cycle = -0.055 * math.sin((i + phase) / 7.5) + 0.0012 * i
        price.append(round(r["base"] * (1 + cycle + n_p[i]), 2))
        volume.append(max(3, round(r["vol"] * (1 + 0.3 * math.sin((i + phase + 5) / 6) + n_v[i]))))
        jeonse.append(round(r["jeonse"] + 3 * math.sin((i + phase) / 7.5) + n_j[i], 1))
    return {"price84": price, "volume": volume, "jeonse_ratio": jeonse}


SUPPLY_SAMPLE = {"2026": 9200, "2027": 6400, "2028": 5100, "2029": 7600, "2030": 5800}


# ---------------------------------------------------------------- 실제 데이터 (미검증)
def http_get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (daily-report)"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read()


def collect_ecos(key, months):
    """한국은행 ECOS: 기준금리, 주택담보대출 금리(신규취급액). 미검증."""
    def series(stat, item):
        url = (f"https://ecos.bok.or.kr/api/StatisticSearch/{key}/json/kr/1/200/"
               f"{stat}/M/{months[0][0]}{months[0][1]:02d}/{months[-1][0]}{months[-1][1]:02d}/{item}")
        rows = json.loads(http_get(url))["StatisticSearch"]["row"]
        by = {r["TIME"]: float(r["DATA_VALUE"]) for r in rows}
        out, last = [], None
        for y, m in months:
            last = by.get(f"{y}{m:02d}", last)
            out.append(last)
        first = next(v for v in out if v is not None)
        return [first if v is None else v for v in out]
    return {"base_rate": series("722Y001", "0101000"),
            "mortgage_rate": series("121Y006", "BECBLA0302")}


def collect_molit(key, months):
    """국토교통부 아파트 매매 실거래가: 생활권별 84㎡ 중위가격과 거래량. 미검증."""
    deals = {r["id"]: {ym: [] for ym in months} for r in REGIONS}
    counts = {r["id"]: {ym: 0 for ym in months} for r in REGIONS}
    for gu in sorted({r["gu"] for r in REGIONS} | {"30170"}):
        for ym in months:
            url = ("https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade"
                   f"?serviceKey={urllib.parse.quote(key, safe='%')}&LAWD_CD={gu}"
                   f"&DEAL_YMD={ym[0]}{ym[1]:02d}&numOfRows=2000&pageNo=1")
            for item in ET.fromstring(http_get(url)).iter("item"):
                dong = (item.findtext("umdNm") or "").strip()
                area = float(item.findtext("excluUseAr") or 0)
                amount = float((item.findtext("dealAmount") or "0").replace(",", "")) / 10000
                for r in REGIONS:
                    if dong in r["dongs"]:
                        counts[r["id"]][ym] += 1
                        if 83 <= area <= 86:
                            deals[r["id"]][ym].append(amount)
    out = {}
    for r in REGIONS:
        price, last = [], None
        for ym in months:
            if deals[r["id"]][ym]:
                last = round(statistics.median(deals[r["id"]][ym]), 2)
            price.append(last)
        if all(p is None for p in price):
            raise ValueError(f"{r['name']}: 84㎡ 거래 없음")
        first = next(p for p in price if p is not None)
        out[r["id"]] = {"price84": [first if p is None else p for p in price],
                        "volume": [counts[r["id"]][ym] for ym in months]}
    return out


def collect_news(previous):
    """구글 뉴스 RSS (키 불필요). 실패하면 이전 뉴스를 유지한다."""
    items, seen = [], set()
    for q in ["대전 아파트", "대전 부동산 경매"]:
        url = ("https://news.google.com/rss/search?q=" + urllib.parse.quote(q + " when:7d")
               + "&hl=ko&gl=KR&ceid=KR:ko")
        try:
            root = ET.fromstring(http_get(url, timeout=20))
        except Exception as e:  # noqa: BLE001
            log(f"[news] {q}: {e}")
            continue
        for it in root.iter("item"):
            title = (it.findtext("title") or "").strip()
            source = (it.findtext("source") or "").strip()
            if source and title.endswith(" - " + source):
                title = title[: -len(source) - 3]
            if not title or title in seen:
                continue
            seen.add(title)
            try:
                when = parsedate_to_datetime(it.findtext("pubDate")).astimezone(KST)
            except Exception:  # noqa: BLE001
                continue
            items.append({"title": title, "source": source, "link": it.findtext("link") or "",
                          "date": when.strftime("%Y-%m-%d %H:%M")})
    if not items:
        return previous
    items.sort(key=lambda x: x["date"], reverse=True)
    return items[:20]


# ---------------------------------------------------------------- 점수
WEIGHTS = {"position": 20, "trend": 15, "volume": 10, "jeonse": 10, "rate": 15, "auction": 15, "supply": 15}
FACTOR_NAMES = {"position": "가격 위치", "trend": "가격 추세", "volume": "거래량", "jeonse": "전세가율",
                "rate": "대출 금리", "auction": "경매 동향", "supply": "미분양"}


def avg(xs):
    return sum(xs) / len(xs)


def region_factors(reg, city, i):
    """i번째 달 기준으로 지표별 점수(0~100, 높을수록 매수에 유리)와 설명을 만든다."""
    lo = max(0, i - WINDOW + 1)
    p = reg["price84"][lo:i + 1]
    pos = (p[-1] - min(p)) / (max(p) - min(p)) if max(p) > min(p) else 0.5
    chg6 = pct_change(reg["price84"][i], reg["price84"][max(0, i - 6)])
    v = reg["volume"][lo:i + 1]
    vratio = avg(v[-3:]) / avg(v) if avg(v) else 1
    jeonse = reg["jeonse_ratio"][i]
    rate = city["mortgage_rate"][i]
    rate_chg = rate - city["mortgage_rate"][max(0, i - 3)]
    auc = city["auction_count"]
    auc_chg = pct_change(avg(auc[max(0, i - 2):i + 1]), avg(auc[max(0, i - 8):max(1, i - 5)]))
    bid = city["auction_bid_ratio"][i]
    uns = city["unsold"][lo:i + 1]
    uratio = uns[-1] / avg(uns)
    return {
        "position": (100 - 70 * pos,
                     f"최근 3년 가격 범위에서 {'낮은' if pos < 0.4 else '높은' if pos > 0.6 else '중간'} 쪽입니다 (하단 0%, 상단 100% 중 {pos * 100:.0f}%)"),
        "trend": (piece(chg6, [(-6, 25), (-3, 40), (-1, 65), (0.5, 80), (2, 70), (5, 45), (8, 30)]),
                  f"84㎡ 매매가가 6개월 동안 {chg6:+.1f}% 움직였습니다"),
        "volume": (piece(vratio, [(0.5, 25), (0.8, 45), (1.0, 60), (1.3, 80), (1.8, 70)]),
                   f"최근 3개월 거래량이 3년 평균의 {vratio * 100:.0f}%입니다"),
        "jeonse": (piece(jeonse, [(50, 30), (60, 50), (70, 80), (80, 90)]),
                   f"전세가율이 {jeonse:.1f}%입니다"),
        "rate": (piece(rate, [(3, 90), (4, 65), (5, 40), (6, 20)]),
                 f"주택담보대출 금리가 {rate:.2f}%입니다 (3개월 전보다 {rate_chg:+.2f}%p)"),
        "auction": ((piece(auc_chg, [(-20, 75), (0, 60), (20, 45), (50, 30)])
                     + piece(bid, [(70, 30), (80, 50), (90, 70), (100, 80)])) / 2,
                    f"아파트 경매 건수가 6개월 전보다 {auc_chg:+.0f}%, 낙찰가율은 {bid:.1f}%입니다"),
        "supply": (piece(uratio, [(0.6, 80), (1.0, 60), (1.5, 35), (2.0, 25)]),
                   f"미분양이 {uns[-1]:,}호로 3년 평균의 {uratio * 100:.0f}%입니다"),
    }


def market_score(factors):
    return sum(WEIGHTS[k] * factors[k][0] for k in WEIGHTS) / 100


def months_left(today):
    return (DEADLINE.year - today.year) * 12 + DEADLINE.month - today.month - (1 if today.day > DEADLINE.day else 0)


def urgency_bonus(market, left):
    u = min(1.0, max(0.0, (30 - left) / 24))
    return max(0.0, (85 - market) * u)


def verdict(score):
    if score >= 70:
        return {"key": "go", "label": "적극 검토", "text": "조건에 맞는 매물이 나오면 계약을 검토할 만한 시기입니다."}
    if score >= 55:
        return {"key": "search", "label": "매물 탐색", "text": "서두를 단계는 아닙니다. 후보 단지를 정하고 매물을 보기 시작하세요."}
    if score >= 40:
        return {"key": "wait", "label": "관망", "text": "지표가 엇갈립니다. 지켜보면서 자금 계획을 준비하세요."}
    return {"key": "hold", "label": "보류", "text": "매수에 불리한 신호가 많습니다. 기다리는 편이 낫습니다."}


def add_months(d, n):
    y, m = divmod(d.year * 12 + d.month - 1 + n, 12)
    return dt.date(y, m + 1, 1)


def build_routes(final, city, i, left):
    bid = city["auction_bid_ratio"][i]
    auc = city["auction_count"]
    aratio = auc[i] / avg(auc[max(0, i - 11):i + 1])
    auction = (piece(bid, [(70, 90), (80, 70), (90, 50), (100, 30)])
               + piece(aratio, [(0.7, 40), (1.0, 55), (1.5, 80)])) / 2
    if left < 8:
        auction *= left / 8
    uns = city["unsold"]
    uratio = uns[i] / avg(uns[max(0, i - WINDOW + 1):i + 1])
    window = left - 30
    presale = piece(uratio, [(0.6, 45), (1.0, 60), (1.5, 75)]) if window > 0 else 0
    return [
        {"id": "trade", "name": "일반 매매", "score": round(final),
         "note": "오늘의 판단 점수와 같습니다. 계약부터 입주까지 보통 2~3개월이 걸립니다."},
        {"id": "auction", "name": "경매", "score": round(auction),
         "note": f"낙찰가율 {bid:.1f}%, 진행 건수는 1년 평균의 {aratio * 100:.0f}%입니다. "
                 "낙찰가율이 낮고 물건이 많을수록 점수가 높습니다."},
        {"id": "presale", "name": "신축 청약", "score": round(presale),
         "note": (f"앞으로 약 {window}개월 안에 분양하는 단지까지 마감 전 입주가 가능합니다."
                  if window > 0 else "지금 분양받으면 사택 만료 전에 입주하기 어렵습니다.")
                 + " (분양부터 입주까지 30개월 가정)"},
    ]


def build_timeline(today, left):
    rows = [
        ("일반 매매", "매물 탐색 시작", -12), ("일반 매매", "계약 마감", -3),
        ("경매", "입찰 시작", -12), ("경매", "낙찰 마감", -6),
        ("신축 청약", "분양 계약 마감", -30),
    ]
    out = []
    for route, step, off in rows:
        when = add_months(DEADLINE, off)
        gap = left + off
        out.append({"route": route, "step": step, "by": f"{when.year}년 {when.month}월", "months_left": gap})
    return out


# ---------------------------------------------------------------- 실행
def main():
    now = dt.datetime.now(KST)
    today = now.date()
    all_months = months_between(EPOCH, (today.year, today.month))
    n = len(all_months)
    previous = {}
    if OUT.exists():
        try:
            previous = json.loads(OUT.read_text(encoding="utf-8"))
        except ValueError:
            previous = {}

    city = sample_city(n)
    regions = {r["id"]: sample_region(r, n) for r in REGIONS}
    sources = {
        "price": {"name": "매매가·거래량", "provider": "국토교통부 실거래가", "sample": True},
        "rate": {"name": "기준금리·대출 금리", "provider": "한국은행 ECOS", "sample": True},
        "jeonse": {"name": "전세가율", "provider": "한국부동산원", "sample": True},
        "auction": {"name": "경매 건수·낙찰가율", "provider": "법원경매정보", "sample": True},
        "delinquency": {"name": "연체율", "provider": "금융감독원", "sample": True},
        "supply": {"name": "미분양·입주 물량", "provider": "국토교통부 통계누리", "sample": True},
        "news": {"name": "뉴스", "provider": "구글 뉴스 RSS", "sample": False},
    }

    if os.environ.get("ECOS_KEY"):
        try:
            city.update(collect_ecos(os.environ["ECOS_KEY"], all_months))
            sources["rate"]["sample"] = False
        except Exception as e:  # noqa: BLE001
            log(f"[ecos] 실패, 샘플 유지: {e}")
    if os.environ.get("DATA_GO_KR_KEY"):
        try:
            for rid, vals in collect_molit(os.environ["DATA_GO_KR_KEY"], all_months[-WINDOW:]).items():
                pad = n - len(vals["price84"])
                regions[rid]["price84"] = [vals["price84"][0]] * pad + vals["price84"]
                regions[rid]["volume"] = [vals["volume"][0]] * pad + vals["volume"]
            sources["price"]["sample"] = False
        except Exception as e:  # noqa: BLE001
            log(f"[molit] 실패, 샘플 유지: {e}")

    news = collect_news(previous.get("news", []))
    i = n - 1
    left = months_left(today)

    region_out, market_by_month = [], []
    for r in REGIONS:
        f = region_factors(regions[r["id"]], city, i)
        market = market_score(f)
        price = regions[r["id"]]["price84"][i]
        fit = "in" if BUDGET[0] <= price <= BUDGET[1] else "under" if price < BUDGET[0] else "over"
        region_out.append({
            "id": r["id"], "name": r["name"], "area": r["area"], "commute": r["commute"],
            "price": price, "chg6": round(pct_change(price, regions[r["id"]]["price84"][i - 6]), 1),
            "jeonse": regions[r["id"]]["jeonse_ratio"][i], "volume": regions[r["id"]]["volume"][i],
            "score": round(market + urgency_bonus(market, left)), "budget": fit,
            "series": {k: v[-WINDOW:] for k, v in regions[r["id"]].items()},
        })

    # 월별 시장 점수 (후보 생활권 평균)
    for j in range(n - WINDOW, n):
        market_by_month.append(round(avg([market_score(region_factors(regions[r["id"]], city, j))
                                          for r in REGIONS]), 1))

    # 오늘의 근거: 생활권 평균 점수로 유리한 요인과 불리한 요인을 고른다
    per_region = [region_factors(regions[r["id"]], city, i) for r in REGIONS]
    mid = region_factors(regions["dunsan"], city, i)
    factors = []
    for k in WEIGHTS:
        s = avg([f[k][0] for f in per_region])
        text = mid[k][1] if k in ("rate", "auction", "supply") else None
        if text is None:
            if k == "position":
                low = [r["name"] for r, f in zip(REGIONS, per_region) if f[k][0] >= 72]
                text = (f"최근 3년 가격 범위의 낮은 쪽에 있는 생활권: {', '.join(low)}" if low
                        else "후보 생활권 대부분이 최근 3년 가격 범위의 중간 이상에 있습니다")
            elif k == "trend":
                text = f"84㎡ 매매가 6개월 변동률 평균 {avg([r['chg6'] for r in region_out]):+.1f}%"
            elif k == "volume":
                vr = avg([avg(regions[r['id']]['volume'][i - 2:i + 1]) / avg(regions[r['id']]['volume'][-WINDOW:])
                          for r in REGIONS])
                text = f"최근 3개월 거래량이 3년 평균의 {vr * 100:.0f}%입니다"
            else:
                text = f"전세가율 평균 {avg([r['jeonse'] for r in region_out]):.1f}%"
        factors.append({"key": k, "name": FACTOR_NAMES[k], "weight": WEIGHTS[k], "score": round(s), "text": text})

    market = sum(f["weight"] * f["score"] for f in factors) / 100
    bonus = urgency_bonus(market, left)
    final = market + bonus

    log_rows = [r for r in previous.get("daily_log", []) if r["date"] != today.isoformat()]
    log_rows.append({"date": today.isoformat(), "score": round(final), "market": round(market)})

    data = {
        "generated_at": now.strftime("%Y-%m-%d %H:%M"),
        "today": today.isoformat(),
        "sample": any(s["sample"] for s in sources.values()),
        "sources": sources,
        "deadline": {"date": DEADLINE.isoformat(), "label": "2030년 8월", "days_left": (DEADLINE - today).days,
                     "months_left": left},
        "budget": {"min": BUDGET[0], "max": BUDGET[1]},
        "score": {"final": round(final), "market": round(market), "bonus": round(bonus),
                  "verdict": verdict(final), "factors": factors},
        "routes": build_routes(final, city, i, left),
        "timeline": build_timeline(today, left),
        "months": [ym_label(m) for m in all_months[-WINDOW:]],
        "city": {k: v[-WINDOW:] for k, v in city.items()},
        "supply": SUPPLY_SAMPLE,
        "regions": region_out,
        "score_history": market_by_month,
        "daily_log": log_rows[-400:],
        "news": news,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log(f"wrote {OUT} score={data['score']['final']} sample={data['sample']} news={len(news)}")


if __name__ == "__main__":
    main()
