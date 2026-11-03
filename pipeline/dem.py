#!/usr/bin/env python3
"""Terrain heights from the local tile store.

Where the tiles come from and why this format: see fetch_dem.py.

A terrarium tile is a plain PNG where the height sits in the colour:

    metres = red * 256 + green + blue / 256 - 32768

At zoom 12 one pixel is about 25 m at our latitudes - fine enough to tell a
knoll from its surroundings, coarse enough that a whole park with three
kilometres of margin fits into memory as one array.

Two things this cannot do, and the interface says so instead of pretending:
heights are metres above the ellipsoid of the source model, not above your
local datum, and in wooded country the model is partly a surface model - a
closed canopy reads as a hill. Whoever shows these numbers has to say that.
"""
import math
import os
from collections import OrderedDict

import numpy as np

from common import DATA

ZOOM = 12
TILE = 256
NODATA = -32768

ROOT = os.path.join(DATA, "dem", "terrarium")

# One tile is 256 KB as int16. Two hundred of them are 50 MB and cover a
# large park with margin several times over.
CACHE_TILES = 200


def tile_float(lat, lon, zoom=ZOOM):
    """Tile coordinates as floats - the fraction is the position inside."""
    lat = max(-85.05112878, min(85.05112878, lat))
    n = 2 ** zoom
    x = (lon + 180.0) / 360.0 * n
    rad = math.radians(lat)
    y = (1.0 - math.log(math.tan(rad) + 1.0 / math.cos(rad)) / math.pi) / 2.0 * n
    return x, y


def pixel_metres(lat, zoom=ZOOM):
    """Ground resolution of one pixel at this latitude."""
    return 156543.033928 * math.cos(math.radians(lat)) / (2 ** zoom)


def tiles_for_bbox(bbox, zoom=ZOOM):
    """Every tile (x, y) that touches this bounding box."""
    minx, miny, maxx, maxy = bbox
    x0, y0 = tile_float(maxy, minx, zoom)
    x1, y1 = tile_float(miny, maxx, zoom)
    n = 2 ** zoom
    for x in range(int(math.floor(x0)), int(math.floor(x1)) + 1):
        for y in range(int(math.floor(y0)), int(math.floor(y1)) + 1):
            if 0 <= x < n and 0 <= y < n:
                yield x, y


def tile_path(x, y, zoom=ZOOM, root=ROOT):
    return os.path.join(root, str(zoom), str(x), f"{y}.png")


class Dem:
    """The tile store, with the last few tiles kept decoded."""

    def __init__(self, root=ROOT, zoom=ZOOM):
        self.root = root
        self.zoom = zoom
        self._cache = OrderedDict()
        self.missing = set()

    def available(self):
        """Tiles on disk and something to decode them with.

        Both are checked here rather than at the first tile: a run that
        notices halfway through that pillow is missing has already written
        half the parks with heights and the rest without.
        """
        if not os.path.isdir(os.path.join(self.root, str(self.zoom))):
            return False
        try:
            import PIL  # noqa: F401
        except ImportError:
            return False
        return True

    def tile(self, x, y):
        """One decoded tile, or None where the store has no tile."""
        key = (x, y)
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key]
        path = tile_path(x, y, self.zoom, self.root)
        if not os.path.exists(path):
            self.missing.add(key)
            return None
        from PIL import Image                      # only needed here
        with Image.open(path) as img:
            rgb = np.asarray(img.convert("RGB"), dtype=np.int32)
        ele = (rgb[:, :, 0] * 256 + rgb[:, :, 1] - 32768).astype(np.int16)
        # The blue channel is the fraction of a metre. Dropping it costs at
        # most a metre and halves the arithmetic.
        self._cache[key] = ele
        if len(self._cache) > CACHE_TILES:
            self._cache.popitem(last=False)
        return ele

    def patch(self, bbox):
        """One array over the whole bounding box, as a Patch."""
        tiles = sorted(tiles_for_bbox(bbox, self.zoom))
        if not tiles:
            return None
        xs = [t[0] for t in tiles]
        ys = [t[1] for t in tiles]
        x0, x1 = min(xs), max(xs)
        y0, y1 = min(ys), max(ys)
        rows = (y1 - y0 + 1) * TILE
        cols = (x1 - x0 + 1) * TILE
        grid = np.full((rows, cols), NODATA, dtype=np.int16)
        found = 0
        for x, y in tiles:
            data = self.tile(x, y)
            if data is None:
                continue
            r = (y - y0) * TILE
            c = (x - x0) * TILE
            grid[r:r + TILE, c:c + TILE] = data
            found += 1
        if not found:
            return None
        return Patch(grid, x0 * TILE, y0 * TILE, self.zoom)


class Patch:
    """A height grid with the pixel arithmetic that belongs to it."""

    def __init__(self, grid, px0, py0, zoom):
        self.grid = grid
        self.px0 = px0            # global pixel offset of column 0
        self.py0 = py0            # global pixel offset of row 0
        self.zoom = zoom

    def rowcol(self, lat, lon):
        x, y = tile_float(lat, lon, self.zoom)
        return int(y * TILE) - self.py0, int(x * TILE) - self.px0

    def at(self, lat, lon):
        """Height in metres, or None outside the grid and where it has holes."""
        r, c = self.rowcol(lat, lon)
        if not (0 <= r < self.grid.shape[0] and 0 <= c < self.grid.shape[1]):
            return None
        value = int(self.grid[r, c])
        return None if value == NODATA else value

    def window(self, r, c, radius):
        """A square around one cell, clipped to the grid, holes removed."""
        r0 = max(0, r - radius)
        c0 = max(0, c - radius)
        block = self.grid[r0:r + radius + 1, c0:c + radius + 1]
        valid = block[block != NODATA]
        return valid
