"""Standardize dish names in data/historical_menus.json.

Usage: python scripts/normalize_menus.py [data_dir]

Stage 1 (spelling): abbreviations ("c/", "c"), accents, known misspellings, capitalization.
Stage 2 (aliases): data/dish_aliases.json maps spelled names to one canonical dish name.
Writes data/menus.json (normalized menus) and data/dishes.json (catalog with counts).
The raw names stay in historical_menus.json.
"""
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

# word (or short phrase) -> fixed spelling; matched case-insensitively on whole words
SPELLING = {
    r"c/?": "con",
    r"se": "de",
    r"deverduras": "de verduras",
    r"verdura": "verduras",
    r"fideosb": "fideos",
    r"alverjita|alberjita|arverjita": "arvejita",
    r"alverja|alberja": "arveja",
    r"huancaina|huancaína|huancaína\.": "huancaína",
    r"papa\.? ?la huancaína|papa\.a la huancaína|papa a huancaína": "papa a la huancaína",
    r"arequipeña": "arequipeña",
    r"moron": "morón",
    r"menestron": "menestrón",
    r"brocoli": "brócoli",
    r"bisteck|bistek|bisteak": "bistec",
    r"frejoles|fréjoles|frijoles|frijol|fréjol|frejol": "frijoles",
    r"wuantan|wuanta|wantan|wantán": "wantán",
    r"tartara": "tártara",
    r"cavanossi|cabanossi|cabanosi": "cabanossi",
    r"salpicon": "salpicón",
    r"atun": "atún",
    r"higado": "hígado",
    r"encebollada": "encebollado",
    r"aji": "ají",
    r"rocoso": "rocoto",
    r"secoa": "seco",
    r"saltade": "saltado",
    r"tallarin": "tallarín",
    r"platano": "plátano",
    r"sillao": "sillao",
    r"mani": "maní",
    r"semola": "sémola",
    r"zarza": "salsa",
    r"broasther|broaste|broster": "broaster",
    r"salchipatita|salchipapita": "salchipapa",
    r"chuletas": "chuleta",
    r"mollejitas": "mollejita",
    r"tamales|tamalitos": "tamal",
    r"causita": "causa",
    r"yuquitas fritas|yuquita frita|yuquita dorada|yuca dorada": "yuca frita",
    r"cebiche": "ceviche",
    r"chactado": "chactado",
    r"pollo al ojo": "pollo al horno",
    r"a las finas hierbas": "a las finas hierbas",
    r"en finas hierbas": "a las finas hierbas",
}
_SPELL = [(re.compile(rf"(?<!\w)(?:{k})(?!\w)", re.I), v) for k, v in SPELLING.items()]


def spell(name):
    s = unicodedata.normalize("NFC", name).strip().rstrip(".")
    s = re.sub(r"\s+", " ", s)
    for rx, rep in _SPELL:
        s = rx.sub(rep, s)
    s = re.sub(r"\bcon con\b", "con", s)
    s = s.lower()
    return s[:1].upper() + s[1:]


def main():
    data = Path(sys.argv[1] if len(sys.argv) > 1 else "data")
    menus = json.loads((data / "historical_menus.json").read_text(encoding="utf-8"))
    alias_path = data / "dish_aliases.json"
    aliases = json.loads(alias_path.read_text(encoding="utf-8")) if alias_path.exists() else {"dishes": []}

    canon = {}  # spelled name -> dish entry
    splits = {}  # spelled name -> [canonical names] for lines that listed two dishes
    for d in aliases["dishes"]:
        if "split" in d:
            for v in d["variants"]:
                splits[spell(v)] = d["split"]
            continue
        for v in [d["name"], *d.get("variants", [])]:
            canon[spell(v)] = d

    seen = defaultdict(lambda: {"count": 0, "dates": [], "prices": Counter(), "variants": Counter(), "courses": set()})
    unmapped = Counter()
    out = []
    for m in menus:
        day = {k: m[k] for k in ("date", "weekday", "menu_price")}
        for course in ("entradas", "segundos", "extras"):
            items = []
            expanded = []
            for it in m[course]:
                parts = splits.get(spell(it["name"]))
                expanded += [{**it, "name": p, "original": it["name"]} for p in parts] if parts else [it]
            for it in expanded:
                s = spell(it["name"])
                d = canon.get(s)
                if d is None:
                    unmapped[(course, s)] += 1
                    name = s
                else:
                    name = d["name"]
                original = it.get("original", it["name"])
                new = {"name": name, **{k: v for k, v in it.items() if k not in ("name", "original")}}
                if name != original:
                    new["original"] = original
                items.append(new)
                e = seen[name]
                e["count"] += 1
                e["dates"].append(m["date"])
                e["courses"].add("extra" if course == "extras" else course[:-1])
                e["variants"][original] += 1
                if "price" in it:
                    e["prices"][it["price"]] += 1
                if d:
                    e["meta"] = d
            day[course] = items
        out.append(day)

    catalog = []
    for name, e in sorted(seen.items(), key=lambda kv: (-kv[1]["count"], kv[0])):
        meta = {k: v for k, v in e.get("meta", {}).items() if k not in ("name", "variants", "course")}
        catalog.append({
            "name": name,
            "courses": sorted(e["courses"], key=["entrada", "segundo", "extra"].index),
            **meta,
            "times_served": e["count"],
            "first_served": min(e["dates"]),
            "last_served": max(e["dates"]),
            **({"usual_price": e["prices"].most_common(1)[0][0]} if e["prices"] else {}),
            "spellings_seen": sorted(e["variants"]),
        })

    (data / "menus.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    (data / "dishes.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(out)} menus, {len(catalog)} dishes, {len(unmapped)} unmapped names")
    for (course, s), n in sorted(unmapped.items()):
        print(f"  UNMAPPED {course}: {s} ({n})")


if __name__ == "__main__":
    main()
