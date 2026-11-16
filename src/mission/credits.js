import { THEME, createPanel, fillChamfer, setFont, wrapLines } from './ui.js';

// Credits for the Marswalk mission, as data and as a paged canvas drawing.
//
//   buildCredits(data)                 -> { title, sections: [{ id, title, lines: [{ head (or null), text }] }] }
//   layoutCredits(ctx, credits, box)   -> pages (cached per credits + box)
//   drawCredits(ctx, credits, page, box) -> { page, pages, section }
//   createCreditsPanel({ data, ... })  -> a stand-alone panel with its own pager
//                                         (for the cabin console / debrief)
//
// Everything about the Mars data comes from the mission file (its layers,
// panoramas, facts, assumptions and notes). The FIXED lines below are the only
// text typed here; they repeat CREDITS.md and must be changed together with it.
// Nothing here invents a licence or an address.

export const FIXED = {
  title: 'Credits',
  // Image and terrain credits, as CREDITS.md gives them for each product.
  layerCredit: {
    photo: 'Credit: NASA/JPL-Caltech/University of Arizona/USGS',
    slope: 'Credit: NASA/JPL-Caltech/University of Arizona/USGS',
    backdrop: 'Credit: NASA/JPL-Caltech/MSSS/USGS',
  },
  alwaysOn: ['backdrop'],
  software: [
    { head: 'Three.js 0.170.0', text: 'The 3D library. MIT License, copyright 2010-2024 three.js authors.' },
    {
      head: 'Data files and pipeline',
      text: "The terrain, photo, rover path, sample list and panorama files were made with the Team Protikriti project's pipeline. Its licence has not been verified.",
    },
  ],
  ai: [
    {
      head: 'AI assistance',
      text: 'The code, tests and documents of this project were written with an AI coding assistant (Claude, by Anthropic), directed by the team. The Mars data shown is not AI-generated: it comes from the sources listed here.',
    },
  ],
  notReal: [
    { head: 'Chosen for looks', text: 'Surface colour, sky, dust haze and sun direction. The rover cabin, tablet, beacons, tubes and other objects are simple made-up models.' },
    { head: 'Simulated', text: 'Coring and the Marswalk itself.' },
  ],
};

const sentence = (text) => (/[.!?]$/.test(text) ? text : `${text}.`);

// The full credits from the mission file plus the fixed lines.
export function buildCredits(data) {
  const sections = [];
  sections.push({
    id: 'missions',
    title: 'Missions covered',
    lines: data.missionsCovered.map((name) => {
      const layers = data.layers.filter((l) => l.mission === name || l.mission.includes(`(${name})`));
      return { head: name, text: sentence(`Layers: ${layers.map((l) => l.name).join(', ')}`) };
    }),
  });

  const panoramaCredits = [...new Set((data.panoramas || []).map((p) => p.credit).filter(Boolean))];
  sections.push({
    id: 'layers',
    title: 'Mars data',
    lines: data.layers.map((layer) => {
      const parts = [`${layer.mission}, ${layer.instrument}`, `Source: ${layer.source}`];
      if (layer.retrieved) parts[1] += ` (retrieved ${layer.retrieved})`;
      if (layer.note) parts.push(layer.note);
      if (FIXED.layerCredit[layer.id]) parts.push(FIXED.layerCredit[layer.id]);
      if (layer.id === 'panoramas') for (const credit of panoramaCredits) parts.push(`Credit: ${credit}`);
      return {
        head: FIXED.alwaysOn.includes(layer.id) ? `${layer.name} (always on)` : layer.name,
        text: parts.map(sentence).join(' '),
      };
    }),
  });

  sections.push({
    id: 'facts',
    title: 'Fact sources',
    // One row each: no head, to keep the list short.
    lines: Object.keys(data.facts).map((id) => ({ head: null, text: sentence(`${id}: ${data.facts[id].source}`) })),
  });

  // One credit per label (they are all "ASSUMPTION"), its sentences joined.
  const byLabel = new Map();
  for (const a of data.assumptions) byLabel.set(a.label, [...(byLabel.get(a.label) || []), sentence(a.text)]);
  const assumed = [...byLabel].map(([label, texts]) => ({ head: label, text: texts.join(' ') }));
  sections.push({
    id: 'assumptions',
    title: 'Assumptions and simulated values',
    lines: [
      ...assumed,
      { head: 'SIM', text: sentence(data.telemetryNote) },
      ...FIXED.notReal,
    ],
  });

  sections.push({ id: 'software', title: 'Software', lines: [...FIXED.software, ...FIXED.ai] });
  return { title: FIXED.title, sections };
}

// ---- layout -------------------------------------------------------------------
//
// Rows are laid out once per (credits, box) and cached, so paging costs one
// canvas draw and no measuring. A page never starts with an orphaned heading
// and a credit's first text line stays with its head.

const HEAD_GAP = 0.3; // of a line height, above a credit
const SECTION_GAP = 0.45; // of a line height, above a section title

const layoutCache = new WeakMap();

export function layoutCredits(ctx, credits, { width, height, px = 42, lineHeight = Math.round(px * 1.1) }) {
  const key = `${width}x${height}@${px}/${lineHeight}`;
  let perCredits = layoutCache.get(credits);
  if (!perCredits) layoutCache.set(credits, (perCredits = new Map()));
  if (perCredits.has(key)) return perCredits.get(key);

  // Blocks that must stay together, each a list of rows { kind, text, h }.
  const blocks = [];
  for (const section of credits.sections) {
    let pending = [{ kind: 'section', text: section.title, section: section.title, h: lineHeight * (1 + SECTION_GAP) }];
    for (const line of section.lines) {
      setFont(ctx, px);
      const wrapped = wrapLines(ctx, line.text, width);
      const rows = pending;
      pending = [];
      if (line.head) rows.push({ kind: 'head', text: line.head, h: lineHeight * (1 + HEAD_GAP) });
      rows.push({ kind: 'text', text: wrapped[0], h: line.head ? lineHeight : lineHeight * (1 + HEAD_GAP) });
      blocks.push({ rows, section: section.title });
      // Later lines of a long credit may run on to the next page.
      for (let i = 1; i < wrapped.length; i++) blocks.push({ rows: [{ kind: 'text', text: wrapped[i], h: lineHeight }], section: section.title });
    }
  }
  const pages = [];
  let page = null;
  let used = 0;
  for (const block of blocks) {
    const h = block.rows.reduce((sum, row) => sum + row.h, 0);
    if (!page || used + h > height) {
      page = { rows: [], section: block.section };
      pages.push(page);
      used = 0;
    }
    for (const row of block.rows) page.rows.push(row);
    used += h;
  }
  perCredits.set(key, pages);
  return pages;
}

// Draws one page of the credits into the box (canvas px). The first row's
// top gap is dropped so the page starts at the top of the box.
export function drawCredits(ctx, credits, page, { x, y, width, height, px = 42, lineHeight = Math.round(px * 1.1) }) {
  const pages = layoutCredits(ctx, credits, { width, height, px, lineHeight });
  const index = Math.min(Math.max(page, 0), pages.length - 1);
  const rows = pages[index].rows;
  ctx.textAlign = 'left';
  let top = y;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const h = i === 0 ? lineHeight : row.h;
    top += h;
    const baseline = top - Math.round(lineHeight * 0.24);
    if (row.kind === 'section') {
      setFont(ctx, px, 'bold');
      ctx.fillStyle = THEME.warm;
      ctx.fillText(row.text.toUpperCase(), x, baseline);
      ctx.fillRect(x + ctx.measureText(row.text.toUpperCase()).width + 18, baseline - Math.round(px * 0.36), Math.max(0, width - ctx.measureText(row.text.toUpperCase()).width - 18), 4);
    } else if (row.kind === 'head') {
      setFont(ctx, px, 'bold');
      ctx.fillStyle = THEME.accent;
      ctx.fillText(row.text, x, baseline);
    } else {
      setFont(ctx, px);
      ctx.fillStyle = THEME.text;
      ctx.fillText(row.text, x, baseline);
    }
  }
  return { page: index, pages: pages.length, section: pages[index].section };
}

// ---- stand-alone panel ----------------------------------------------------------
//
// A credits screen with its own "<" and ">" for anywhere outside the tablet
// (cabin console, debrief). The caller adds panel.mesh to the scene and the
// panel to mission.ui: mission.ui.add(credits.panel).
export function createCreditsPanel({ data, name = 'credits-panel', widthPx = 1280, heightPx = 896, widthM = 0.9, px = 42, anisotropy = 4, renderOrder = 0 }) {
  const credits = buildCredits(data);
  const panel = createPanel({ name, widthPx, heightPx, widthM, anisotropy, renderOrder });
  const box = { x: 36, y: 112, width: widthPx - 72, height: heightPx - 112 - 116, px };
  const state = { page: 0, pages: 1, section: '' };

  function pagerButton(ctx, id, bx, by, label, onTap) {
    fillChamfer(ctx, bx, by, 96, 80, { cut: 12, fill: THEME.card, stroke: THEME.accent });
    ctx.fillStyle = THEME.text;
    ctx.textAlign = 'center';
    setFont(ctx, 52, 'bold');
    ctx.fillText(label, bx + 48, by + 58);
    ctx.textAlign = 'left';
    panel.region(id, bx, by, 96, 80, onTap, { hover: true });
  }

  function draw() {
    const ctx = panel.begin();
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, widthPx, heightPx);
    ctx.fillStyle = THEME.text;
    setFont(ctx, 56, 'bold');
    ctx.textAlign = 'left';
    ctx.fillText(credits.title.toUpperCase(), 36, 76);
    const drawn = drawCredits(ctx, credits, state.page, box);
    Object.assign(state, drawn);
    const y = heightPx - 100;
    ctx.fillStyle = THEME.dim;
    setFont(ctx, px);
    ctx.fillText(drawn.section, 36, y + 54);
    pagerButton(ctx, 'credits-prev', widthPx - 330, y, '<', () => api.setPage((state.page + state.pages - 1) % state.pages));
    ctx.fillStyle = THEME.text;
    ctx.textAlign = 'center';
    setFont(ctx, 46, 'bold');
    ctx.fillText(`${state.page + 1} / ${state.pages}`, widthPx - 173, y + 56);
    ctx.textAlign = 'left';
    pagerButton(ctx, 'credits-next', widthPx - 112, y, '>', () => api.setPage((state.page + 1) % state.pages));
    panel.end();
  }

  const api = {
    panel,
    credits,
    state,
    setPage(page) {
      state.page = page;
      draw();
    },
    redraw: draw,
  };
  draw();
  return api;
}
