"""Shared helpers of the POTA map data pipeline."""
import json
import os

DATA = os.environ.get("POTA_DATA", "/data")
CACHE = os.path.join(DATA, "cache")

# POTA programs this map covers. The same codes name the per-country files
# on pota-map.info (ISO code).
PROGRAMS = ["DE", "AT", "CH", "LI", "CZ", "DK", "LU"]

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


def load(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def save(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False)
    os.replace(tmp, path)
