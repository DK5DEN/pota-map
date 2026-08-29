"""Bridge to the issue tracker that holds the reports.

Reports do not live here. The map is only the surface: file one, read it, write
back. They are answered on the tracker side, next to the reports of the other
programs run by the same operator.

Why through the backend and not straight from the browser: the token belongs to
this program. In the JavaScript it would be readable by anyone, and whoever
reads it can file reports in our name all day.

There are no accounts. So that a reporter still finds their answer, the browser
creates a random id on the first report and sends it along with every call. It
is the only thing protecting someone's own reports, so the server accepts
nothing shorter than 128 bits.

Internal notes of the team never come back through this path. That is decided
on the tracker side and cannot be switched off from here.

Both BUG_ENDPOINT and BUG_TOKEN have to be set, otherwise the whole report
feature stays hidden in the frontend.
"""
import os
import re

import httpx

BASE = os.environ.get("BUG_ENDPOINT", "").rstrip("/")
TOKEN = os.environ.get("BUG_TOKEN", "").strip()
ENVIRONMENT = os.environ.get("BUG_ENVIRONMENT", "pota-map")

REPORTER_RE = re.compile(r"^[A-Za-z0-9_-]{22,120}$")
KINDS = {"bug", "feature", "question"}
IMAGE_LIMIT = 5_000_000


class ReportError(Exception):
    """The tracker refused, or does not answer.

    The reason is passed through: "too many reports" and "token expired" are
    two very different things to tell someone.

    Carries a catalogue key next to the text. The browser looks the key up in
    its own language and falls back to the text - which is why the text is
    English here and not in whatever language this server happens to think in.
    """

    def __init__(self, status: int, key: str, text: str):
        super().__init__(text)
        self.status = status
        self.key = key
        self.text = text


def ready() -> bool:
    return bool(TOKEN and BASE)


def check_reporter(reporter: str) -> str:
    if not REPORTER_RE.match(reporter or ""):
        raise ReportError(400, "reports.badId", "Invalid reporter id.")
    return reporter


async def call(path, method="GET", json=None, files=None, timeout=20):
    if not ready():
        raise ReportError(503, "reports.notConfigured",
                          "Reporting is not set up on this server.")
    try:
        async with httpx.AsyncClient(timeout=timeout) as browser:
            answer = await browser.request(
                method, f"{BASE}{path}", json=json, files=files,
                headers={"X-Bug-Token": TOKEN})
    except httpx.HTTPError as error:
        raise ReportError(503, "reports.unreachable",
                          f"The tracker does not answer ({error}).") from error
    if answer.status_code == 404:
        raise ReportError(404, "reports.unknown", "No such report.")
    if answer.status_code >= 400:
        reason = ""
        try:
            payload = answer.json()
            reason = payload.get("detail") or payload.get("message") or ""
            if isinstance(reason, dict):
                reason = reason.get("message") or ""
        except ValueError:
            reason = answer.text[:200]
        if answer.status_code == 429:
            raise ReportError(429, "reports.rateLimited",
                              reason or "Too many reports just now. Try later.")
        if answer.status_code in (401, 403):
            # An invalid token is not the reporter's fault, so do not say so.
            raise ReportError(503, "reports.refusing",
                              "Reporting is not accepting anything right now.")
        raise ReportError(502, "reports.rejected", reason or "The tracker refused.")
    if answer.status_code == 204 or not answer.content:
        return None
    if answer.headers.get("content-type", "").startswith("application/json"):
        return answer.json()
    return {"_typ": answer.headers.get("content-type", "application/octet-stream"),
            "_daten": answer.content}


async def file_report(reporter, contact, title, text, kind, technical=""):
    check_reporter(reporter)
    return await call("/bugs/report", "POST", json={
        "title": title, "details": text,
        "kind": kind if kind in KINDS else "bug",
        "contact": contact, "external_ref": reporter,
        "environment": ENVIRONMENT, "technical": technical,
    })


async def mine(reporter):
    return await call(f"/bugs/app/reports?external_ref={check_reporter(reporter)}")


async def one(bug_id, reporter):
    return await call(f"/bugs/app/reports/{int(bug_id)}?external_ref={check_reporter(reporter)}")


async def reply(bug_id, reporter, author, text):
    check_reporter(reporter)
    return await call(f"/bugs/app/reports/{int(bug_id)}/posts", "POST",
                     json={"body": text, "external_ref": reporter, "author": author})


async def image_to_report(bug_id, reporter, filename, mime, data):
    return await call(
        f"/bugs/app/reports/{int(bug_id)}/images?external_ref={check_reporter(reporter)}",
        "POST", files={"file": (filename, data, mime)}, timeout=40)


async def image_to_post(post_id, filename, mime, data):
    return await call(f"/bugs/app/posts/{int(post_id)}/images", "POST",
                     files={"file": (filename, data, mime)}, timeout=40)


async def may_see_image(reporter, image_id):
    """Does this image belong to a report of this reporter?"""
    for thread in await mine(reporter):
        if any(b["id"] == image_id for b in thread.get("images") or []):
            return True
        for post in thread.get("posts") or []:
            if any(b["id"] == image_id for b in post.get("images") or []):
                return True
    return False


async def image(image_id):
    """Pass an image through: the reporter's browser has no token for the tracker."""
    return await call(f"/bugs/app/images/{int(image_id)}")
