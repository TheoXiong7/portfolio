#!/usr/bin/env python3
"""Refresh static/files/contributions.js (the skyline widget's data) from GitHub.

Uses the gh CLI's login (`gh auth login` first). Writes one `{date, count}` per
day for the last year, oldest first, as a script setting `window.SKYLINE_DATA`
rather than JSON, so the widget also works when index.html is opened straight
from disk, where fetch() is blocked. Run after a while to keep the widget current:

    python scripts/contributions.py [login]
"""
import json
import subprocess
import sys
from pathlib import Path

LOGIN = sys.argv[1] if len(sys.argv) > 1 else "TheoXiong7"
OUT = Path(__file__).resolve().parent.parent / "static" / "files" / "contributions.js"

QUERY = """
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}
"""

raw = subprocess.run(
    ["gh", "api", "graphql", "-f", f"query={QUERY}", "-F", f"login={LOGIN}"],
    check=True, capture_output=True, text=True,
).stdout
weeks = json.loads(raw)["data"]["user"]["contributionsCollection"]["contributionCalendar"]["weeks"]
days = [{"date": d["date"], "count": d["contributionCount"]} for w in weeks for d in w["contributionDays"]]
OUT.write_text("window.SKYLINE_DATA = " + json.dumps(days, separators=(",", ":")) + ";\n")
print(f"{OUT.name}: {len(days)} days, {sum(d['count'] for d in days)} contributions")
