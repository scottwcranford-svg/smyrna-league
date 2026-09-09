#!/usr/bin/env python3
"""Copy data/book.json into Firestore under books/<passcode>/….

Uses Firestore's REST API with no credentials: the security rules admit the path
because keys/<passcode> exists. Run once after setting up the Firebase project.

    python migrate-to-firebase.py --project smyrna-side-book --key smyrna-2026-tigers
"""
import argparse, json, sys, urllib.request

def to_value(v):
    if v is None: return {"nullValue": None}
    if isinstance(v, bool): return {"booleanValue": v}
    if isinstance(v, int): return {"integerValue": str(v)}
    if isinstance(v, float): return {"doubleValue": v}
    if isinstance(v, str): return {"stringValue": v}
    if isinstance(v, list): return {"arrayValue": {"values": [to_value(x) for x in v]}}
    if isinstance(v, dict): return {"mapValue": {"fields": {k: to_value(x) for k, x in v.items()}}}
    raise TypeError(type(v))

def put(project, path, data):
    url = f"https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents/{path}"
    body = json.dumps({"fields": {k: to_value(v) for k, v in data.items()}}).encode()
    req = urllib.request.Request(url, data=body, method="PATCH", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True, help="Firebase projectId")
    ap.add_argument("--key", required=True, help="the league passcode (must exist as keys/<key>)")
    ap.add_argument("--book", default="data/book.json")
    a = ap.parse_args()
    book = json.load(open(a.book, encoding="utf-8"))
    base = f"books/{a.key}"
    n = 0
    for doc_id, data in (book.get("league") or {}).items():
        data = dict(data)
        if doc_id == "roster" and isinstance(data.get("players"), list):
            # Firestore forbids arrays inside arrays; the page stores the roster as text
            data["playersJson"] = json.dumps(data.pop("players"), separators=(",", ":"))
        put(a.project, f"{base}/league/{doc_id}", data); n += 1
        print("league/" + doc_id)
    for bet_id, data in (book.get("bets") or {}).items():
        put(a.project, f"{base}/bets/{bet_id}", data); n += 1
        print("bets/" + bet_id)
    print(f"wrote {n} documents to {base}")

if __name__ == "__main__":
    try: main()
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode()[:300]); sys.exit(1)
