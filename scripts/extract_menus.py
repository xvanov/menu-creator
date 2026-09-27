"""Extract daily menus from the WhatsApp group export.

Usage: python scripts/extract_menus.py <chat.txt> [out_dir]

Keeps only the "Hoy en la Sazón de Luis tenemos para degustar" posts (the
ones containing *ENTRADA*), drops orders, chatter, and attachments.
A menu posted after 15:00 is treated as the next day's menu; when several
posts land on the same service date, the last one wins (it is the corrected one).
"""
import json
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

MSG_START = re.compile(
    r"^(\d{1,2})/(\d{1,2})/(\d{4}), (\d{1,2}):(\d{2})[\s ]([ap])\.[\s ]?m\. - (?:([^:]+): )?(.*)$"
)
EDITED = re.compile(r"\s*<Se editó este mensaje\.>\s*")
# "S/15.00", "S/ 20", "👉S/15.00", or a bare trailing "15.00"
PRICE = re.compile(r"(?:👉\s*)?(?:S/\.?\s*(\d+(?:[.,]\d+)?)|\s(\d+[.,]\d{2})\s*$)", re.I)
SECTION = re.compile(r"^\W*(entradas?|segundos?|fondos?|extras?|especial(?:es)?)\W*$", re.I)
WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


def parse_messages(lines):
    msg = None
    for line in lines:
        m = MSG_START.match(line)
        if m:
            if msg:
                yield msg
            d, mo, y, h, mi, ap, author, text = m.groups()
            h = int(h) % 12 + (12 if ap == "p" else 0)
            msg = {"ts": datetime(int(y), int(mo), int(d), h, int(mi)), "author": author, "lines": [text]}
        elif msg:
            msg["lines"].append(line)
    if msg:
        yield msg


def clean_item(line):
    line = EDITED.sub("", line)
    line = line.replace("📌", "").replace("*", "").strip(" -•\t")
    price = None
    pm = PRICE.search(line)
    if pm:
        price = float((pm.group(1) or pm.group(2)).replace(",", "."))
        line = line[: pm.start()]
    line = re.sub(r"\s+", " ", line).strip(" -👉:")
    return line, price


def parse_menu(msg):
    text = "\n".join(msg["lines"])
    if "ENTRADA" not in text.upper() or "SEGUNDO" not in text.upper():
        return None
    menu = {"entradas": [], "segundos": [], "extras": []}
    base_price = None
    section = None
    for raw in msg["lines"]:
        line = EDITED.sub("", raw).strip()
        if not line:
            continue
        if "MENU" in line.upper() and base_price is None:
            pm = PRICE.search(line)
            if pm:
                base_price = float((pm.group(1) or pm.group(2)).replace(",", "."))
            continue
        sm = SECTION.match(line.replace("*", "").strip())
        if sm:
            word = sm.group(1).lower()
            section = "entradas" if word.startswith("entrada") else "extras" if word.startswith(("extra", "especial")) else "segundos"
            continue
        if section is None:
            continue
        if line.startswith("(") and menu[section]:
            menu[section][-1]["description"] = line.strip("()* ")
            continue
        name, price = clean_item(line)
        if not name:
            continue
        item = {"name": name}
        if price is not None:
            item["price"] = price
        menu[section].append(item)
    if not menu["entradas"] or not menu["segundos"]:
        return None
    menu["menu_price"] = base_price
    return menu


def main():
    src = Path(sys.argv[1])
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "data")
    out.mkdir(parents=True, exist_ok=True)
    lines = src.read_text(encoding="utf-8").splitlines()

    by_date = {}
    for msg in parse_messages(lines):
        menu = parse_menu(msg)
        if not menu:
            continue
        service = msg["ts"].date()
        if msg["ts"].hour >= 15:
            service += timedelta(days=1)
        by_date[service] = {"posted_at": msg["ts"].isoformat(timespec="minutes"), **menu}

    menus = []
    for day in sorted(by_date):
        m = by_date[day]
        menus.append({"date": day.isoformat(), "weekday": WEEKDAYS[day.weekday()], **m})

    (out / "historical_menus.json").write_text(json.dumps(menus, ensure_ascii=False, indent=2), encoding="utf-8")

    md = ["# Menús históricos — La Sazón de Luis", "", f"{len(menus)} días extraídos del grupo de WhatsApp.", ""]
    for m in menus:
        price = f" — S/{m['menu_price']:.2f}" if m["menu_price"] else ""
        md.append(f"## {m['date']} ({m['weekday']}){price}")
        for key, title in (("entradas", "Entradas"), ("segundos", "Segundos"), ("extras", "Extras")):
            if not m[key]:
                continue
            md.append(f"**{title}**")
            for it in m[key]:
                p = f" — S/{it['price']:.2f}" if "price" in it else ""
                md.append(f"- {it['name']}{p}")
        md.append("")
    (out / "historical_menus.md").write_text("\n".join(md), encoding="utf-8")
    print(f"{len(menus)} menus -> {out}")


if __name__ == "__main__":
    main()
