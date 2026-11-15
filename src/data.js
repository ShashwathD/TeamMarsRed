// Loads one walk patch (data/walk/<site>/walk.json + dem.bin) and exposes it
// in the viewer's local frame:
//   x = metres east, z = metres south, y = metres up, origin at the patch centre.
//   y = 0 is the ground height at the patch centre (true scale, no exaggeration).
//
// dem.bin is little-endian int16, row 0 = north, col 0 = west,
// metres = heightOffsetM + value * heightStepM. Samples are cell-centred:
// sample (row r, col c) sits (c + 0.5) * spacing east of the west edge and
// (r + 0.5) * spacing south of the north edge.

export const MARS_RADIUS_M = 3396190;

const SITE_NAME = /^[A-Za-z0-9_-]+$/;

export function siteFromUrl(defaultSite) {
  const site = new URLSearchParams(window.location.search).get('site') || defaultSite;
  if (!SITE_NAME.test(site)) throw new Error(`Bad site name "${site}"`);
  return site;
}

async function fetchOk(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

export async function loadWalkPatch(site, baseUrl = './data/walk/') {
  const folder = `${baseUrl}${site}/`;
  const meta = await (await fetchOk(`${folder}walk.json`)).json();
  const buffer = await (await fetchOk(`${folder}dem.bin`)).arrayBuffer();

  const cols = meta.width;
  const rows = meta.height;
  if (buffer.byteLength !== cols * rows * 2) {
    throw new Error(`${folder}dem.bin is ${buffer.byteLength} bytes, expected ${cols * rows * 2}`);
  }

  // Decode explicitly as little-endian so it does not depend on the CPU.
  const view = new DataView(buffer);
  const heights = new Float32Array(cols * rows); // true elevation in metres, NaN = no data
  let min = Infinity;
  let max = -Infinity;
  let nodataCount = 0;
  for (let i = 0; i < heights.length; i++) {
    const raw = view.getInt16(i * 2, true);
    if (raw === meta.nodata) {
      heights[i] = NaN;
      nodataCount++;
    } else {
      const h = meta.heightOffsetM + raw * meta.heightStepM;
      heights[i] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  if (nodataCount === heights.length) throw new Error(`${folder}dem.bin has no valid heights`);

  const spacing = meta.spacingM;
  const sizeX = cols * spacing; // metres west-east
  const sizeZ = rows * spacing; // metres north-south

  const patch = {
    site,
    folder,
    meta,
    cols,
    rows,
    spacing,
    sizeX,
    sizeZ,
    heights,
    minHeightM: min,
    maxHeightM: max,
    nodataShare: nodataCount / heights.length,
    originHeightM: 0,

    // Local position of a sample centre.
    colToX: (c) => (c + 0.5) * spacing - sizeX / 2,
    rowToZ: (r) => (r + 0.5) * spacing - sizeZ / 2,

    // Walkable area: the square spanned by the sample centres.
    bounds: {
      minX: 0.5 * spacing - sizeX / 2,
      maxX: (cols - 0.5) * spacing - sizeX / 2,
      minZ: 0.5 * spacing - sizeZ / 2,
      maxZ: (rows - 0.5) * spacing - sizeZ / 2,
    },

    lonLatToLocal(lon, lat) {
      return {
        x: ((lon - meta.west) / (meta.east - meta.west) - 0.5) * sizeX,
        z: ((meta.north - lat) / (meta.north - meta.south) - 0.5) * sizeZ,
      };
    },

    localToLonLat(x, z) {
      return {
        lon: meta.west + (x / sizeX + 0.5) * (meta.east - meta.west),
        lat: meta.north - (z / sizeZ + 0.5) * (meta.north - meta.south),
      };
    },

    // True elevation (metres) by bilinear interpolation, or NaN where every
    // surrounding sample is no-data. Positions outside are clamped to the edge.
    elevationAt(x, z) {
      let fc = (x + sizeX / 2) / spacing - 0.5;
      let fr = (z + sizeZ / 2) / spacing - 0.5;
      fc = Math.min(Math.max(fc, 0), cols - 1);
      fr = Math.min(Math.max(fr, 0), rows - 1);
      const c0 = Math.min(Math.floor(fc), cols - 2);
      const r0 = Math.min(Math.floor(fr), rows - 2);
      const tx = fc - c0;
      const tz = fr - r0;
      const i = r0 * cols + c0;
      const samples = [heights[i], heights[i + 1], heights[i + cols], heights[i + cols + 1]];
      const weights = [(1 - tx) * (1 - tz), tx * (1 - tz), (1 - tx) * tz, tx * tz];
      let sum = 0;
      let weightSum = 0;
      for (let k = 0; k < 4; k++) {
        if (!Number.isNaN(samples[k])) {
          sum += samples[k] * weights[k];
          weightSum += weights[k];
        }
      }
      return weightSum > 0 ? sum / weightSum : NaN;
    },

    // Local y of the ground (metres above the patch-centre ground).
    groundY(x, z) {
      return patch.elevationAt(x, z) - patch.originHeightM;
    },
  };

  const centre = patch.elevationAt(0, 0);
  patch.originHeightM = Number.isNaN(centre) ? (min + max) / 2 : centre;
  return patch;
}
