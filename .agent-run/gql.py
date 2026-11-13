import json, urllib.request, urllib.error, sys

ACCOUNT_TAG = "f670a698e17bf160c8e4679823e68916"


def gql(query, variables=None, root="data"):
    payload = {
        "queries": [
            {
                "refId": "A",
                "datasource": {"type": "yesoreyeram-infinity-datasource", "uid": "fleet-cloudflare"},
                "type": "graphql",
                "source": "url",
                "url": "https://api.cloudflare.com/client/v4/graphql",
                "url_options": {
                    "method": "POST",
                    "body_graphql_query": query,
                    "body_graphql_variables": json.dumps(variables or {}),
                    "headers": [{"name": "Content-Type", "value": "application/json"}],
                },
                "parser": "backend",
                "format": "table",
                "root_selector": root,
            }
        ],
        "from": "2026-09-14T00:00:00Z",
        "to": "2026-11-05T00:00:00Z",
    }
    req = urllib.request.Request(
        "http://127.0.0.1:3001/api/ds/query",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            body = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode()[:2000])
        sys.exit(1)
    res = body["results"]["A"]
    if res.get("error"):
        print("QUERY ERROR:", res["error"][:2000])
        sys.exit(1)
    frames = res["frames"]
    names = [f["name"] for f in frames[0]["schema"]["fields"]]
    vals = frames[0]["data"]["values"]
    rows = [dict(zip(names, col)) for col in zip(*vals)]
    out = {}
    for row in rows:
        for k, v in row.items():
            if isinstance(v, str) and v.startswith("{"):
                try:
                    out[k] = json.loads(v)
                except Exception:
                    out[k] = v
            else:
                out[k] = v
    return out


if __name__ == "__main__":
    q = sys.argv[1]
    variables = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    out = gql(q, variables)
    if len(sys.argv) > 3:
        with open(sys.argv[3], "w") as f:
            json.dump(out, f, indent=1)
    else:
        json.dump(out, sys.stdout, indent=1)
