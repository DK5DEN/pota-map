"""Small backend of the POTA map.

Two jobs, no more:
  * cache the live spots from api.pota.app so that not every visitor knocks
    on POTA's door separately,
  * serve the activations per callsign (the table is built by the pipeline).

Everything else - tiles, search index, GeoJSON per park - is served statically
by nginx. The optional report bridge lives in reports.py.
"""
import asyncio
import json
import logging
import os
import re
import time
from typing import Any

import httpx
from fastapi import (APIRouter, Body, FastAPI, File, HTTPException, Query, Response,
                     UploadFile)
from fastapi.responses import JSONResponse

import reports as reportmodule

DATA = os.environ.get("POTA_DATA", "/data")
SPOT_URL = "https://api.pota.app/spot/activator"
PLAN_URL = "https://api.pota.app/activation"
SPOT_TTL = int(os.environ.get("SPOT_TTL", "45"))
PLAN_TTL = int(os.environ.get("PLAN_TTL", "900"))
# The host this installation runs under. Required: it is the router rule, the
# public tile URL, and the name we give when calling other people's APIs. POTA
# rejects the default library user agent, and knocking on a foreign API under
# someone else's name is worse than not knocking at all - so this is not
# allowed to fall back to a default.
HOST = os.environ.get("PUBLIC_HOST", "").strip()
if not HOST:
    raise RuntimeError(
        "PUBLIC_HOST is not set. Put the host this instance runs under into "
        "the environment (see .env.example).")
UA = f"{HOST}/1.0 (+https://{HOST}; POTA map)"

# Map extent: spots outside of it are of no interest here.
BBOX = (45.0, 5.0, 58.5, 19.5)   # lat_min, lon_min, lat_max, lon_max

log = logging.getLogger("pota-map")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

app = FastAPI(title="POTA-Map", docs_url=None, redoc_url=None)

_spot_cache: dict[str, Any] = {"at": 0.0, "data": []}
_spot_lock = asyncio.Lock()
_plan_cache: dict[str, Any] = {"at": 0.0, "data": []}
_plan_lock = asyncio.Lock()
_activations: dict[str, list[str]] = {}


def load_activations() -> None:
    path = os.path.join(DATA, "activations_by_call.json")
    global _activations
    try:
        with open(path, encoding="utf-8") as fh:
            _activations = json.load(fh)
        log.info("activations loaded: %d callsigns", len(_activations))
    except FileNotFoundError:
        log.warning("no activation table at %s yet", path)
        _activations = {}
    except Exception as exc:
        log.error("activation table unreadable: %s", exc)
        _activations = {}


@app.on_event("startup")
async def startup() -> None:
    load_activations()


def in_bbox(lat: float, lon: float) -> bool:
    return BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]


def age_text(spot_time: str) -> str:
    """POTA sends UTC without a timezone - turn that into a short "X min ago"."""
    try:
        t = time.strptime(spot_time[:19], "%Y-%m-%dT%H:%M:%S")
        minutes = int((time.time() - time.mktime(t) + time.timezone) / 60)
    except Exception:
        return ""
    if minutes < 1:
        return "gerade eben"
    if minutes < 60:
        return f"vor {minutes} min"
    return f"vor {minutes // 60} h {minutes % 60} min"


async def fetch_spots() -> list[dict]:
    async with httpx.AsyncClient(timeout=20, headers={"User-Agent": UA}) as client:
        r = await client.get(SPOT_URL)
        r.raise_for_status()
        raw = r.json()

    out = []
    for s in raw:
        lat, lon = s.get("latitude"), s.get("longitude")
        if lat is None or lon is None:
            continue
        lat, lon = float(lat), float(lon)
        if not in_bbox(lat, lon):
            continue
        out.append({
            "id": s.get("spotId"),
            "activator": s.get("activator"),
            "reference": s.get("reference"),
            "name": s.get("name") or s.get("parkName"),
            "frequency": s.get("frequency"),
            "mode": s.get("mode"),
            "spotter": s.get("spotter"),
            "comments": s.get("comments"),
            "spotTime": s.get("spotTime"),
            "age": age_text(s.get("spotTime") or ""),
            "lat": lat,
            "lon": lon,
        })
    return out


@app.get("/api/spots")
async def spots() -> JSONResponse:
    now = time.time()
    if now - _spot_cache["at"] < SPOT_TTL:
        return JSONResponse(_spot_cache["data"],
                            headers={"Cache-Control": f"public, max-age={SPOT_TTL}"})

    async with _spot_lock:
        # While waiting for the lock another call may have refreshed already.
        if time.time() - _spot_cache["at"] < SPOT_TTL:
            return JSONResponse(_spot_cache["data"])
        try:
            data = await fetch_spots()
            _spot_cache["data"] = data
            _spot_cache["at"] = time.time()
        except Exception as exc:
            log.warning("spots not reachable at POTA: %s", exc)
            if not _spot_cache["data"]:
                raise HTTPException(502, {"key": "api.potaDown", "text": "POTA is not reachable."})

    return JSONResponse(_spot_cache["data"],
                        headers={"Cache-Control": f"public, max-age={SPOT_TTL}"})


async def fetch_plans() -> list[dict]:
    """Scheduled activations. POTA lists them worldwide; keep the programs
    this map covers, and only those that are not over yet."""
    async with httpx.AsyncClient(timeout=25, headers={"User-Agent": UA}) as client:
        r = await client.get(PLAN_URL)
        r.raise_for_status()
        raw = r.json()

    today = time.strftime("%Y-%m-%d")
    programs = {"DE", "AT", "CH", "LI", "CZ", "DK", "LU"}
    out = []
    for p in raw:
        ref = p.get("reference") or ""
        if ref.split("-")[0] not in programs:
            continue
        if (p.get("endDate") or "9999") < today:
            continue
        out.append({
            "id": p.get("scheduledActivitiesId"),
            "activator": p.get("activator"),
            "reference": ref,
            "name": p.get("name"),
            "start": p.get("startDate"),
            "end": p.get("endDate"),
            "startTime": p.get("startTime"),
            "endTime": p.get("endTime"),
            "frequencies": p.get("frequencies"),
            "comments": p.get("comments"),
        })
    out.sort(key=lambda x: (x["start"] or "", x["reference"]))
    return out


@app.get("/api/scheduled")
async def scheduled() -> JSONResponse:
    now = time.time()
    if now - _plan_cache["at"] < PLAN_TTL:
        return JSONResponse(_plan_cache["data"],
                            headers={"Cache-Control": f"public, max-age={PLAN_TTL}"})
    async with _plan_lock:
        if time.time() - _plan_cache["at"] < PLAN_TTL:
            return JSONResponse(_plan_cache["data"])
        try:
            _plan_cache["data"] = await fetch_plans()
            _plan_cache["at"] = time.time()
        except Exception as exc:
            log.warning("scheduled activations not reachable: %s", exc)
            if not _plan_cache["data"]:
                raise HTTPException(502, {"key": "api.potaDown", "text": "POTA is not reachable."})
    return JSONResponse(_plan_cache["data"],
                        headers={"Cache-Control": f"public, max-age={PLAN_TTL}"})


@app.get("/api/activations")
async def activations(call: str = Query(..., min_length=3, max_length=16)) -> JSONResponse:
    refs = _activations.get(call.strip().upper(), [])
    return JSONResponse(refs, headers={"Cache-Control": "public, max-age=3600"})


# Park details: website, first activator, activation and QSO count. POTA keeps
# these behind two addresses, both undocumented and without a stated rate
# limit - so they are cached here instead of being fetched from every browser.
# A park rarely changes, half a day of cache is plenty.
PARK_TTL = int(os.environ.get("PARK_TTL", "21600"))
PARK_URL = "https://api.pota.app/park"
_park_cache: dict[str, tuple[float, dict]] = {}
_park_lock = asyncio.Lock()
REF_RE = re.compile(r"^[A-Z0-9]{1,4}-\d{4,5}$")


async def fetch_park(ref: str) -> dict:
    async with httpx.AsyncClient(timeout=15, headers={"User-Agent": UA}) as client:
        details, stats = await asyncio.gather(
            client.get(f"{PARK_URL}/{ref}"),
            client.get(f"{PARK_URL}/stats/{ref}"),
            return_exceptions=True,
        )
    out: dict[str, Any] = {"reference": ref}
    if not isinstance(details, Exception) and details.status_code == 200:
        p = details.json()
        out.update({
            "website": p.get("website") or None,
            "kind": p.get("parktypeDesc") or None,
            "region": p.get("locationName") or None,
            "first_activator": p.get("firstActivator") or None,
            "first_activation": p.get("firstActivationDate") or None,
        })
    if not isinstance(stats, Exception) and stats.status_code == 200:
        z = stats.json()
        out.update({
            "activations": z.get("activations"),
            "attempts": z.get("attempts"),
            "qsos": z.get("contacts"),
        })
    return out


@app.get("/api/park/{ref}")
async def park(ref: str) -> JSONResponse:
    ref = ref.strip().upper()
    if not REF_RE.match(ref):
        raise HTTPException(400, {"key": "api.badReference", "text": "Not a POTA reference."})
    now = time.time()
    hit = _park_cache.get(ref)
    if hit and now - hit[0] < PARK_TTL:
        return JSONResponse(hit[1],
                            headers={"Cache-Control": f"public, max-age={PARK_TTL}"})
    async with _park_lock:
        hit = _park_cache.get(ref)
        if hit and time.time() - hit[0] < PARK_TTL:
            return JSONResponse(hit[1])
        try:
            data = await fetch_park(ref)
        except Exception as exc:
            log.warning("park details %s not reachable: %s", ref, exc)
            if hit:
                return JSONResponse(hit[1])
            raise HTTPException(502, {"key": "api.potaDown", "text": "POTA is not reachable."})
        # Otherwise the cache grows with every reference ever clicked.
        if len(_park_cache) > 4000:
            _park_cache.clear()
        _park_cache[ref] = (time.time(), data)
    return JSONResponse(data,
                        headers={"Cache-Control": f"public, max-age={PARK_TTL}"})


@app.post("/api/reload")
async def reload_data() -> dict:
    """Called after a pipeline run so the activation table is fresh."""
    load_activations()
    return {"ok": True, "callsigns": len(_activations)}


@app.get("/api/health")
async def health() -> dict:
    return {
        "ok": True,
        "callsigns": len(_activations),
        "spots_cached": len(_spot_cache["data"]),
        "spots_age_s": round(time.time() - _spot_cache["at"]) if _spot_cache["at"] else None,
        # Whether this installation has the report bridge. The map asks here
        # before it fetches the module for it - most installations do not have
        # it, and a 404 probe would only clutter their console.
        "reports": reportmodule.ready(),
    }


# --------------------------------------------------------------------- Reports
#
# The reports live in an issue tracker elsewhere; this is only the door to it.
# Why it needs no accounts, and what the reporter id is, is explained in
# reports.py.


# The whole block below only exists when this installation has a tracker to
# report into. Most do not, so the routes are not registered at all - a 404 is
# a clearer answer than an endpoint that always refuses.
reports_api = APIRouter()


def _as_http_error(exc: "reportmodule.ReportError") -> HTTPException:
    return HTTPException(status_code=exc.status,
                         detail={"key": exc.key, "text": exc.text})


@reports_api.post("/api/report")
async def report_new(payload: dict = Body(...)) -> dict:
    title = str(payload.get("title") or "").strip()
    contact = str(payload.get("contact") or "").strip()
    text = str(payload.get("details") or "").strip()
    if len(title) < 3:
        raise HTTPException(400, {"key": "report.needSubject", "text": "The subject is missing."})
    if len(contact) < 2:
        raise HTTPException(400, {"key": "report.needContact",
                                 "text": "Without a callsign or mail address there is no way back."})
    if len(text) < 10:
        raise HTTPException(400, {"key": "report.needText",
                                 "text": "One or two more sentences help a lot."})
    try:
        return await reportmodule.file_report(
            str(payload.get("ref") or ""), contact[:120], title[:120], text[:4000],
            str(payload.get("kind") or "bug"),
            technical=str(payload.get("technical") or "")[:4000])
    except reportmodule.ReportError as exc:
        raise _as_http_error(exc) from exc


# In the query string the reporter id is `reporter`. Two older names are still
# accepted because a browser may still hold an older build of the page.
#
# The oldest one was `ref` - a common name for referral tracking, which content
# blockers strip from every URL (`$removeparam=ref`). The request then arrived
# without an id: own reports empty, a single one not readable, and only for the
# people running a blocker. Filing a report was never affected, there the id
# sits in the body.
def _reporter_id(*candidates: str) -> str:
    for c in candidates:
        if c and c.strip():
            return c.strip()
    return ""


@reports_api.get("/api/reports")
async def reports_list(reporter: str = Query(""),
                       legacy_reporter: str = Query("", alias="melder"),
                       legacy_ref: str = Query("", alias="ref")) -> dict:
    ref = _reporter_id(reporter, legacy_reporter, legacy_ref)
    # Without an id there is nothing to show - and that is not an error:
    # whoever never filed a report has none. As a required field, a call
    # without it came back as a bare 422 from FastAPI, and the page showed
    # the reporter a number instead of a sentence.
    if not ref:
        return {"reports": []}
    try:
        return {"reports": await reportmodule.mine(ref)}
    except reportmodule.ReportError as exc:
        raise _as_http_error(exc) from exc


@reports_api.get("/api/reports/{bug_id}")
async def report_one(bug_id: int, reporter: str = Query(""),
                     legacy_reporter: str = Query("", alias="melder"),
                     legacy_ref: str = Query("", alias="ref")) -> dict:
    ref = _reporter_id(reporter, legacy_reporter, legacy_ref)
    # Same answer as for someone else's report: without an id it does not
    # belong to this browser, and who it does belong to is none of its
    # business.
    if not ref:
        raise HTTPException(404, {"key": "report.otherBrowser",
                                 "text": "That report belongs to another browser."})
    try:
        return await reportmodule.one(bug_id, ref)
    except reportmodule.ReportError as exc:
        raise _as_http_error(exc) from exc


@reports_api.post("/api/reports/{bug_id}/replies")
async def report_reply(bug_id: int, payload: dict = Body(...)) -> dict:
    text = str(payload.get("body") or "").strip()
    if not text:
        raise HTTPException(400, {"key": "report.emptyReply", "text": "The reply is empty."})
    ref = str(payload.get("ref") or "")
    try:
        # The author comes from the report itself, not from the body: otherwise
        # the tracker labels the post with the reporter id, which is a random
        # number from the browser - visible to everyone reading it over there.
        contact = ((await reportmodule.one(bug_id, ref)) or {}).get("contact") or ""
        return await reportmodule.reply(bug_id, ref, contact, text[:4000])
    except reportmodule.ReportError as exc:
        raise _as_http_error(exc) from exc


@reports_api.post("/api/reports/{bug_id}/images")
async def report_image(bug_id: int, reporter: str = Query(""),
                       legacy_reporter: str = Query("", alias="melder"),
                       legacy_ref: str = Query("", alias="ref"),
                       post: int | None = Query(None),
                       file: UploadFile = File(...)) -> dict:
    ref = _reporter_id(reporter, legacy_reporter, legacy_ref)
    data = await file.read(reportmodule.IMAGE_LIMIT + 1)
    if len(data) > reportmodule.IMAGE_LIMIT:
        raise HTTPException(413, {"key": "report.imageTooBig", "text": "The image is larger than 5 MB."})
    try:
        if post:
            return await reportmodule.image_to_post(post, file.filename, file.content_type, data)
        return await reportmodule.image_to_report(bug_id, ref, file.filename,
                                                file.content_type, data)
    except reportmodule.ReportError as exc:
        raise _as_http_error(exc) from exc


@reports_api.get("/api/reports/images/{image_id}")
async def report_image_read(image_id: int, reporter: str = Query(""),
                           legacy_reporter: str = Query("", alias="melder"),
                           legacy_ref: str = Query("", alias="ref")) -> Response:
    """Pass an image through, but only to the reporter it belongs to.

    The tracker only checks that the image belongs to this program, not to
    whom. Image ids are sequential - without this check anyone could count
    through the screenshots of other people's reports.
    """
    ref = _reporter_id(reporter, legacy_reporter, legacy_ref)
    if not ref:
        raise HTTPException(404, {"key": "report.imageMissing", "text": "Image not found."})
    try:
        if not await reportmodule.may_see_image(ref, image_id):
            raise HTTPException(404, {"key": "report.imageMissing", "text": "Image not found."})
        answer = await reportmodule.image(image_id)
    except reportmodule.ReportError as exc:
        raise _as_http_error(exc) from exc
    return Response(content=answer["_daten"], media_type=answer["_typ"],
                    headers={"Cache-Control": "private, max-age=300"})


if reportmodule.ready():
    app.include_router(reports_api)
    log.info("reporting enabled, bridging to %s", reportmodule.BASE)
else:
    log.info("reporting disabled: set BUG_ENDPOINT and BUG_TOKEN to enable it")
