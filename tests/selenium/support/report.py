"""Builds a run report keyed by Test Case ID.

pytest's own output is organised around python function names; the test plan
this suite implements is organised around TC-PO-F01 style identifiers. This
module keeps the second view, so a finished run produces something that can be
read straight against the test-case matrix: id, feature, expected result,
verdict, measured timing, and the screenshot taken at the decisive moment.

Outputs, all under tests/selenium/reports/:
    results.json   machine-readable, one object per test case
    results.csv    same data, for pasting into the documentation matrix
    report.html    self-contained page, no external assets
"""

from __future__ import annotations

import csv
import datetime
import html
import json
import os
from dataclasses import asdict, dataclass, field

from . import config

CATEGORY_LABEL = {
    "functional": "Functionality Testing",
    "performance": "Performance Testing",
    "security": "Security Testing",
    "usability": "Usability Testing",
}

ROLE_LABEL = {"owner": "Pet Owner", "vet": "Veterinarian", "admin": "Admin",
              "system": "Deployment"}

OUTCOME_LABEL = {
    "passed": "PASS",
    "failed": "FAIL",
    "skipped": "SKIPPED",
    "error": "ERROR",
}


@dataclass
class Record:
    tc_id: str = ""
    feature: str = ""
    expected: str = ""
    category: str = ""
    role: str = ""
    outcome: str = "unknown"
    duration: float = 0.0
    measured: dict = field(default_factory=dict)
    notes: list = field(default_factory=list)
    screenshots: list = field(default_factory=list)
    failure: str = ""
    nodeid: str = ""


class Reporter:
    """Collects Records during the run and writes the artefacts at the end."""

    def __init__(self) -> None:
        self.records: dict[str, Record] = {}
        self.started = datetime.datetime.now()
        self.environment: dict[str, str] = {}

    def record_for(self, nodeid: str) -> Record:
        return self.records.setdefault(nodeid, Record(nodeid=nodeid))

    # -- writing -----------------------------------------------------------

    def write(self) -> dict[str, str]:
        os.makedirs(config.REPORT_DIR, exist_ok=True)
        rows = sorted(
            self.records.values(),
            key=lambda r: (
                list(CATEGORY_LABEL).index(r.category) if r.category in CATEGORY_LABEL else 9,
                r.tc_id or r.nodeid,
            ),
        )

        json_path = os.path.join(config.REPORT_DIR, "results.json")
        with open(json_path, "w", encoding="utf-8") as handle:
            json.dump(
                {
                    "started": self.started.isoformat(timespec="seconds"),
                    "finished": datetime.datetime.now().isoformat(timespec="seconds"),
                    "environment": self.environment,
                    "results": [asdict(r) for r in rows],
                },
                handle,
                indent=2,
            )

        csv_path = os.path.join(config.REPORT_DIR, "results.csv")
        with open(csv_path, "w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(
                ["Test Case ID", "Category", "Role", "Feature / Module", "Result",
                 "Duration (s)", "Measured", "Notes", "Failure"]
            )
            for r in rows:
                writer.writerow([
                    r.tc_id,
                    CATEGORY_LABEL.get(r.category, r.category),
                    ROLE_LABEL.get(r.role, r.role),
                    r.feature,
                    OUTCOME_LABEL.get(r.outcome, r.outcome),
                    f"{r.duration:.2f}",
                    "; ".join(f"{k}={v}" for k, v in r.measured.items()),
                    " | ".join(r.notes),
                    r.failure.replace("\n", " ")[:500],
                ])

        html_path = os.path.join(config.REPORT_DIR, "report.html")
        with open(html_path, "w", encoding="utf-8") as handle:
            handle.write(self._html(rows))

        return {"json": json_path, "csv": csv_path, "html": html_path}

    # -- html --------------------------------------------------------------

    def _html(self, rows: list[Record]) -> str:
        totals = {"passed": 0, "failed": 0, "skipped": 0, "error": 0}
        for r in rows:
            totals[r.outcome] = totals.get(r.outcome, 0) + 1

        def esc(value) -> str:
            return html.escape(str(value or ""))

        parts: list[str] = []
        parts.append(
            """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BVetter - Selenium Test Run</title><style>
:root{--bg:#f6f8fb;--card:#fff;--ink:#16202e;--muted:#657286;--line:#e2e8f0;
      --pass:#0f9d58;--fail:#d93025;--skip:#a0752a;--accent:#0b5cab}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
     font:15px/1.55 "Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:26px;margin:0 0 4px}
.sub{color:var(--muted);margin:0 0 24px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:28px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;
      padding:14px 18px;min-width:120px}
.card b{display:block;font-size:26px;line-height:1.2}
.card span{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em}
.card.pass b{color:var(--pass)} .card.fail b{color:var(--fail)} .card.skip b{color:var(--skip)}
h2{font-size:17px;margin:30px 0 10px;padding-bottom:6px;border-bottom:2px solid var(--line)}
table{width:100%;border-collapse:collapse;background:var(--card);
      border:1px solid var(--line);border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);
      vertical-align:top;font-size:13.5px}
th{background:#eef2f7;font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
tr:last-child td{border-bottom:none}
td.id{font-family:ui-monospace,Consolas,monospace;white-space:nowrap;font-weight:600}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11.5px;
       font-weight:700;letter-spacing:.04em}
.badge.passed{background:#e3f4ea;color:var(--pass)}
.badge.failed{background:#fce8e6;color:var(--fail)}
.badge.skipped{background:#fdf2dd;color:var(--skip)}
.badge.error{background:#fce8e6;color:var(--fail)}
.meta{color:var(--muted);font-size:12.5px}
.measured{font-family:ui-monospace,Consolas,monospace;font-size:12px;white-space:nowrap}
.fail-msg{color:var(--fail);font-size:12px;white-space:pre-wrap;
          font-family:ui-monospace,Consolas,monospace}
.env{background:var(--card);border:1px solid var(--line);border-radius:12px;
     padding:14px 18px;font-size:13px;color:var(--muted)}
.env code{color:var(--ink)}
.scroll{overflow-x:auto}
</style></head><body><div class="wrap">"""
        )

        finished = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        parts.append(f"<h1>BVetter &mdash; Automated Test Run</h1>")
        parts.append(
            f'<p class="sub">Selenium WebDriver &middot; started '
            f'{esc(self.started.strftime("%Y-%m-%d %H:%M:%S"))} &middot; finished {esc(finished)}</p>'
        )

        parts.append('<div class="cards">')
        parts.append(f'<div class="card"><b>{len(rows)}</b><span>Test cases</span></div>')
        parts.append(f'<div class="card pass"><b>{totals["passed"]}</b><span>Passed</span></div>')
        parts.append(f'<div class="card fail"><b>{totals["failed"] + totals["error"]}</b><span>Failed</span></div>')
        parts.append(f'<div class="card skip"><b>{totals["skipped"]}</b><span>Skipped</span></div>')
        parts.append("</div>")

        if self.environment:
            parts.append('<div class="env"><strong>Environment</strong><br>')
            parts.append(
                " &middot; ".join(
                    f"{esc(k)}: <code>{esc(v)}</code>" for k, v in self.environment.items()
                )
            )
            parts.append("</div>")

        for category, label in CATEGORY_LABEL.items():
            group = [r for r in rows if r.category == category]
            if not group:
                continue
            parts.append(f"<h2>{esc(label)}</h2>")
            parts.append('<div class="scroll"><table><thead><tr>')
            parts.append(
                "<th>Test Case ID</th><th>Role</th><th>Feature / Module</th>"
                "<th>Result</th><th>Time</th><th>Measured</th><th>Notes</th>"
            )
            parts.append("</tr></thead><tbody>")
            for r in group:
                measured = "<br>".join(
                    f"{esc(k)} = {esc(v)}" for k, v in r.measured.items()
                )
                notes = "<br>".join(esc(n) for n in r.notes)
                if r.failure:
                    notes += f'<div class="fail-msg">{esc(r.failure[:400])}</div>'
                if r.screenshots:
                    links = " ".join(
                        f'<a href="screenshots/{esc(os.path.basename(s))}">shot</a>'
                        for s in r.screenshots
                    )
                    notes += f'<div class="meta">{links}</div>'
                parts.append(
                    "<tr>"
                    f'<td class="id">{esc(r.tc_id)}</td>'
                    f'<td class="meta">{esc(ROLE_LABEL.get(r.role, r.role))}</td>'
                    f"<td>{esc(r.feature)}<div class=\"meta\">{esc(r.expected)}</div></td>"
                    f'<td><span class="badge {esc(r.outcome)}">'
                    f"{esc(OUTCOME_LABEL.get(r.outcome, r.outcome))}</span></td>"
                    f'<td class="measured">{r.duration:.2f}s</td>'
                    f'<td class="measured">{measured}</td>'
                    f"<td>{notes}</td>"
                    "</tr>"
                )
            parts.append("</tbody></table></div>")

        parts.append("</div></body></html>")
        return "".join(parts)
