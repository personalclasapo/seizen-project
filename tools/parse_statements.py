#!/usr/bin/env python3
"""
明細解析スクリプト（サービスアカウント方式）

Drive の明細フォルダから未解析ファイルを読み、
- 全取引を raw_transactions に
- 定期支払い候補を transaction_candidates に
書き込み、upload_history のステータスを更新する。

事前準備:
  1. tools/secrets/sa.json にサービスアカウントの鍵を置く
  2. tools/parse_config.json を作成（parse_config.example.json をコピー）
  3. スプレッドシートを SA に編集者で共有、明細フォルダを SA に閲覧者で共有

実行:
  python3 tools/parse_statements.py
"""

import csv
import io
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly",
]

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# サービス名の正規化と種別推定（摘要キーワード → (サービス名, 種別)）
KEYWORD_MAP = [
    ("NETFLIX", "Netflix", "サブスク（動画配信）"),
    ("SPOTIFY", "Spotify", "サブスク"),
    ("APPLE.COM", "Apple", "要確認"),
    ("AMAZON PRIME", "Amazonプライム", "サブスク"),
    ("DOCOMO", "ドコモ", "通信費"),
    ("AU ", "au", "通信費"),
    ("SOFTBANK", "ソフトバンク", "通信費"),
    ("東京電力", "東京電力エナジー", "公共料金（電気）"),
    ("電力", "電力会社", "公共料金（電気）"),
    ("東京ガス", "東京ガス", "公共料金（ガス）"),
    ("ガス", "ガス会社", "公共料金（ガス）"),
    ("水道", "水道局", "公共料金（水道）"),
    ("NHK", "NHK受信料", "メディア（NHK・新聞）"),
    ("新聞", "新聞", "メディア（NHK・新聞）"),
    ("家賃", "家賃", "住居費"),
    ("年金", "年金", "年金"),
    ("給与", "給与", "給与"),
]


def guess_service(description):
    up = description.upper()
    for kw, name, cat in KEYWORD_MAP:
        if kw.upper() in up:
            return name, cat
    return None, "その他"


def load_config():
    path = os.path.join(ROOT, "tools", "parse_config.json")
    if not os.path.exists(path):
        sys.exit(f"設定ファイルがありません: {path}\n"
                 f"tools/parse_config.example.json をコピーして作成してください。")
    with open(path) as f:
        return json.load(f)


def build_services(cfg):
    key_path = os.path.join(ROOT, cfg["service_account_file"])
    if not os.path.exists(key_path):
        sys.exit(f"サービスアカウント鍵がありません: {key_path}")
    creds = service_account.Credentials.from_service_account_file(key_path, scopes=SCOPES)
    sheets = build("sheets", "v4", credentials=creds)
    drive = build("drive", "v3", credentials=creds)
    return sheets, drive


# ── Sheets ヘルパー ──
def sheet_values(sheets, ssid, rng):
    res = sheets.spreadsheets().values().get(spreadsheetId=ssid, range=rng).execute()
    return res.get("values", [])


def sheet_append(sheets, ssid, rng, rows):
    if not rows:
        return
    sheets.spreadsheets().values().append(
        spreadsheetId=ssid, range=rng,
        valueInputOption="RAW", insertDataOption="INSERT_ROWS",
        body={"values": rows},
    ).execute()


def sheet_update(sheets, ssid, rng, rows):
    sheets.spreadsheets().values().update(
        spreadsheetId=ssid, range=rng,
        valueInputOption="RAW", body={"values": rows},
    ).execute()


def rows_to_dicts(values):
    if not values or len(values) < 2:
        return [], (values[0] if values else [])
    header = values[0]
    out = []
    for i, row in enumerate(values[1:], start=2):
        d = {h: (row[j] if j < len(row) else "") for j, h in enumerate(header)}
        d["_row"] = i
        out.append(d)
    return out, header


# ── Drive ヘルパー ──
def find_file(drive, folder_id, name):
    safe = name.replace("'", "\\'")
    q = f"'{folder_id}' in parents and name = '{safe}' and trashed = false"
    res = drive.files().list(q=q, fields="files(id,name,mimeType)", pageSize=1).execute()
    files = res.get("files", [])
    return files[0] if files else None


def download_text(drive, file_id):
    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, drive.files().get_media(fileId=file_id))
    done = False
    while not done:
        _, done = downloader.next_chunk()
    data = buf.getvalue()
    for enc in ("utf-8-sig", "cp932", "utf-8"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


# ── CSV パース ──
def parse_card_csv(text):
    """利用日,利用店名,利用金額,支払方法 形式 → 取引リスト"""
    txns = []
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        date = (row.get("利用日") or "").strip()
        desc = (row.get("利用店名") or "").strip()
        amt = (row.get("利用金額") or "").strip().replace(",", "")
        if not date or not amt:
            continue
        txns.append({
            "date": date, "description": desc,
            "amount": int(float(amt)), "type": "出金", "source": "カード",
        })
    return txns


def parse_bank_csv(text):
    """日付,摘要,出金,入金,残高 形式 → 取引リスト"""
    txns = []
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        date = (row.get("日付") or "").strip()
        desc = (row.get("摘要") or "").strip()
        out = (row.get("出金") or "").strip().replace(",", "")
        inc = (row.get("入金") or "").strip().replace(",", "")
        if not date:
            continue
        if out:
            txns.append({"date": date, "description": desc,
                         "amount": int(float(out)), "type": "出金", "source": "銀行"})
        elif inc:
            txns.append({"date": date, "description": desc,
                         "amount": int(float(inc)), "type": "入金", "source": "銀行"})
    return txns


def parse_csv(text):
    head = text[:200]
    if "利用日" in head or "利用店名" in head:
        return parse_card_csv(text)
    if "摘要" in head or "残高" in head:
        return parse_bank_csv(text)
    return []


def month_of(date_str):
    for fmt in ("%Y/%m/%d", "%Y-%m-%d"):
        try:
            return datetime.strptime(date_str, fmt).strftime("%Y-%m")
        except ValueError:
            continue
    return date_str[:7]


def normalize_desc(desc):
    # 店舗の支店名などを落として正規化キーにする
    d = re.sub(r"[0-9０-９]+", "", desc)
    d = re.sub(r"(店|支店|本店|営業所)$", "", d.strip())
    return d.strip().upper()


def detect_candidates(txns):
    """同じ摘要が2ヶ月以上に出る出金を定期候補とする"""
    groups = defaultdict(list)
    for t in txns:
        if t["type"] != "出金":
            continue
        groups[normalize_desc(t["description"])].append(t)

    candidates = []
    for key, items in groups.items():
        months = {month_of(t["date"]) for t in items}
        if len(months) < 2:
            continue
        amounts = [t["amount"] for t in items]
        monthly = round(sum(amounts) / len(amounts))
        rep = items[-1]["description"]
        name, cat = guess_service(rep)
        candidates.append({
            "service_name": name or rep,
            "raw_description": rep,
            "monthly_amount": monthly,
            "billing_cycle": "月額",
            "category_guess": cat,
            "members": items,
        })
    return candidates


def main():
    cfg = load_config()
    ssid = cfg["spreadsheet_id"]
    folder_id = cfg["folder_id"]
    sheets, drive = build_services(cfg)

    uploads, _ = rows_to_dicts(sheet_values(sheets, ssid, "upload_history!A1:I"))
    pending = [u for u in uploads if (u.get("status") or "未解析") != "解析済"]
    if not pending:
        print("未解析のアップロードはありません。")
        return

    ts = datetime.now().strftime("%Y%m%d%H%M%S")
    raw_rows, cand_rows = [], []
    cand_seq = 0

    for up in pending:
        fname = up.get("file_name", "")
        ftype = (up.get("file_type") or "").upper()
        print(f"処理中: {fname}")
        if ftype != "CSV":
            print(f"  → {ftype} はこのスクリプトでは未対応（手動解析対象）。スキップ")
            continue
        fmeta = find_file(drive, folder_id, fname)
        if not fmeta:
            print(f"  → フォルダ内に見つかりません。スキップ")
            continue
        text = download_text(drive, fmeta["id"])
        txns = parse_csv(text)
        if not txns:
            print(f"  → 取引を解析できませんでした。スキップ")
            continue

        candidates = detect_candidates(txns)
        # 候補IDを割り当て、生取引に紐付け
        desc_to_cand = {}
        for c in candidates:
            cand_seq += 1
            cid = f"cand_{ts}_{cand_seq}"
            c["id"] = cid
            for m in c["members"]:
                desc_to_cand[id(m)] = cid

        for t in txns:
            raw_rows.append([
                f"rtx_{ts}_{len(raw_rows)+1}", up.get("id", ""),
                t["date"], t["description"], t["amount"],
                t["type"], t["source"], desc_to_cand.get(id(t), ""),
            ])
        for c in candidates:
            cand_rows.append([
                c["id"], up.get("id", ""), c["service_name"], c["raw_description"],
                c["monthly_amount"], c["billing_cycle"], c["category_guess"],
                "未登録", "",
            ])

        dates = sorted(month_of(t["date"]) for t in txns)
        sheet_update(sheets, ssid, f"upload_history!E{up['_row']}:I{up['_row']}", [[
            t and txns[0]["source"] or "", dates[0], dates[-1], "解析済", len(candidates),
        ]])
        print(f"  → 取引{len(txns)}件 / 定期候補{len(candidates)}件")

    if raw_rows:
        sheet_append(sheets, ssid, "raw_transactions!A1", raw_rows)
    if cand_rows:
        sheet_append(sheets, ssid, "transaction_candidates!A1", cand_rows)

    print(f"\n完了: raw_transactions {len(raw_rows)}件 / transaction_candidates {len(cand_rows)}件 を書き込みました。")


if __name__ == "__main__":
    main()
