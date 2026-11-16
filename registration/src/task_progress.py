"""Small, flushed progress records consumed by the local web server."""
import json


def report_progress(label, completed=None, total=None, unit="slices"):
    payload = {"label": label}
    if completed is not None and total is not None and total > 0:
        payload.update(completed=completed, total=total, unit=unit)
    print("[PROGRESS] " + json.dumps(payload, ensure_ascii=True), flush=True)
