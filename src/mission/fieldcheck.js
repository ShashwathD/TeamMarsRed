import { THEME, drawParagraph, fillChamfer, fitText, setFont, wrapLines } from './ui.js';

// FIELD CHECK (brief: FIELD CHECK). Four tap questions on the tablet, three
// choices each. Questions, choices, right answers and sources all come from
// the mission file (data.fieldCheck); nothing is typed here. A wrong answer
// shows the right one plus its source. There is no penalty and no fail state.
//
// It is a full-screen page on the forearm tablet (tablet.setModal), so it
// works the same with a VR ray and with the desktop mouse. The score goes to
// mission.stats.fieldCheck = { right, total } for the debrief; only the first
// answer to each question counts.
//
// The canvas is drawn again only after a tap.

// mission.stats per the stations contract. Before the stations, mission.stats
// was already a function (triangle count); if it still is, the counters are
// kept as properties on it, so both mission.stats() and mission.stats.coresLogged work.
function ensureStats(mission) {
  const fresh = { stationsDone: 0, stationCount: 0, coresLogged: 0, coreCount: 5, slopeWarnings: 0, fieldCheck: null, distanceM: 0, path: [] };
  if (!mission.stats) mission.stats = fresh;
  else for (const key of Object.keys(fresh)) if (!(key in mission.stats)) mission.stats[key] = fresh[key];
  return mission.stats;
}

export function createFieldCheck({ mission }) {
  const questions = mission.data.fieldCheck.questions;
  const total = questions.length;
  const state = {
    phase: 'intro', // 'intro' | 'question' | 'result'
    index: 0,
    answers: questions.map(() => null), // the choice tapped for each question
    right: 0,
    done: false,
    open: false,
    clippedText: null, // for the layout check
  };

  const tablet = () => mission.tablet;
  const refresh = () => {
    if (tablet()) tablet().redraw();
  };

  function choice(ctx, kit, id, y, label, { fill, stroke, colour, mark, onTap }) {
    const x = 32;
    const w = kit.W - 64;
    const h = 96;
    fillChamfer(ctx, x, y, w, h, { fill, stroke, lineWidth: 5 });
    ctx.fillStyle = colour;
    ctx.textBaseline = 'middle';
    const room = w - 56 - (mark ? 260 : 0);
    setFont(ctx, kit.MIN_PX, 'bold');
    if (ctx.measureText(label).width > room) state.clippedText = `choice: ${label}`;
    fitText(ctx, label, x + 28, y + h / 2 + 3, 46, room, { weight: 'bold', minPx: kit.MIN_PX });
    if (mark) {
      ctx.textAlign = 'right';
      fitText(ctx, mark, x + w - 28, y + h / 2 + 3, kit.MIN_PX, 240, { weight: 'bold', minPx: kit.MIN_PX });
      ctx.textAlign = 'left';
    }
    ctx.textBaseline = 'alphabetic';
    if (onTap) kit.panel.region(id, x, y, w, h, onTap);
  }

  function header(ctx, kit, right) {
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, kit.W, kit.H);
    ctx.fillStyle = THEME.accent;
    setFont(ctx, 54, 'bold');
    ctx.fillText('FIELD CHECK', 32, 84);
    ctx.fillStyle = THEME.dim;
    ctx.textAlign = 'right';
    setFont(ctx, kit.MIN_PX);
    if (right) ctx.fillText(right, kit.W - 300, 82);
    ctx.textAlign = 'left';
    kit.button(ctx, 'fc-close', kit.W - 276, 20, 244, 92, state.phase === 'result' ? 'CLOSE' : 'LATER', () => fieldCheck.close(), { px: 44 });
  }

  function drawIntro(ctx, kit) {
    header(ctx, kit, '');
    ctx.fillStyle = THEME.text;
    setFont(ctx, 50, 'bold');
    ctx.fillText(`${total} questions about what you saw today.`, 32, 230);
    ctx.fillStyle = THEME.dim;
    setFont(ctx, kit.MIN_PX);
    drawParagraph(ctx, `Tap one of three answers. If it is wrong you are shown the right one and where it comes from. No penalty, no time charged.`, 32, 310, kit.W - 64, 56, 3);
    kit.button(ctx, 'fc-start', kit.W / 2 - 240, 560, 480, 128, 'START', () => fieldCheck.start(), { on: true, px: 56 });
  }

  function drawQuestion(ctx, kit) {
    const q = questions[state.index];
    const picked = state.answers[state.index];
    header(ctx, kit, `Question ${state.index + 1} of ${total}`);
    ctx.fillStyle = THEME.text;
    setFont(ctx, 48, 'bold');
    const asked = drawParagraph(ctx, q.question, 32, 186, kit.W - 64, 58, 2);
    if (asked.clipped) state.clippedText = `question ${q.id}`;
    q.choices.forEach((label, k) => {
      const y = 286 + k * 110;
      if (picked === null) {
        choice(ctx, kit, `fc-choice-${k}`, y, label, { fill: THEME.card, stroke: THEME.cardLine, colour: THEME.text, onTap: () => fieldCheck.answer(k) });
      } else if (k === q.answer) {
        choice(ctx, kit, `fc-choice-${k}`, y, label, { fill: THEME.accent, stroke: null, colour: THEME.dark, mark: 'RIGHT' });
      } else if (k === picked) {
        choice(ctx, kit, `fc-choice-${k}`, y, label, { fill: THEME.card, stroke: THEME.amber, colour: THEME.amber, mark: 'YOUR PICK' });
      } else {
        choice(ctx, kit, `fc-choice-${k}`, y, label, { fill: THEME.bg, stroke: THEME.cardLine, colour: THEME.dim });
      }
    });
    if (picked === null) return;
    const correct = picked === q.answer;
    ctx.fillStyle = correct ? THEME.accent : THEME.amber;
    fitText(ctx, correct ? 'Correct.' : `Not quite. The answer: ${q.rightAnswer}.`, 32, 668, 46, kit.W - 64, { weight: 'bold', minPx: kit.MIN_PX });
    // The source of the right answer, from the mission file.
    ctx.fillStyle = THEME.dim;
    setFont(ctx, kit.MIN_PX);
    // Wrapped narrow enough to stop short of the NEXT button.
    const lines = wrapLines(ctx, q.source, kit.W - 64 - 340);
    if (lines.length > 3) state.clippedText = `source ${q.id}`;
    for (let i = 0; i < Math.min(lines.length, 3); i++) ctx.fillText(lines[i], 32, 728 + i * 50);
    const lastOne = state.index === total - 1;
    kit.button(ctx, 'fc-next', kit.W - 332, 760, 300, 112, lastOne ? 'FINISH' : 'NEXT', () => fieldCheck.next(), { on: true, px: 52 });
  }

  function drawResult(ctx, kit) {
    header(ctx, kit, '');
    ctx.fillStyle = THEME.text;
    ctx.textAlign = 'center';
    setFont(ctx, 120, 'bold');
    ctx.fillText(`${state.right} / ${total}`, kit.W / 2, 262);
    setFont(ctx, 50, 'bold');
    ctx.fillText('Field Check done', kit.W / 2, 340);
    ctx.fillStyle = THEME.dim;
    setFont(ctx, kit.MIN_PX);
    ctx.fillText('No penalty. The score is in your notebook and the debrief.', kit.W / 2, 404);
    ctx.textAlign = 'left';
    // Each question with its right answer.
    questions.forEach((q, k) => {
      const ok = state.answers[k] === q.answer;
      ctx.fillStyle = ok ? THEME.accent : THEME.amber;
      fitText(ctx, `${k + 1}. ${q.rightAnswer}`, 32, 500 + k * 58, kit.MIN_PX, kit.W - 64, { weight: 'bold', minPx: kit.MIN_PX });
    });
    kit.button(ctx, 'fc-again', kit.W - 332, 760, 300, 112, 'REVIEW', () => fieldCheck.review(), { px: 48 });
  }

  const fieldCheck = {
    state,
    questions,
    total,
    onDone: null, // ({ right, total }) => {} when the last question has been answered

    draw(ctx, kit) {
      state.clippedText = null;
      if (state.phase === 'intro') drawIntro(ctx, kit);
      else if (state.phase === 'question') drawQuestion(ctx, kit);
      else drawResult(ctx, kit);
    },

    // Shows the Field Check on the tablet and lights the tablet. False without a tablet.
    open() {
      if (!tablet()) return false;
      state.open = true;
      tablet().setModal(fieldCheck);
      tablet().setOpen(true);
      return true;
    },
    close() {
      state.open = false;
      if (tablet()) tablet().setModal(null);
    },
    start() {
      if (state.done) return;
      state.phase = 'question';
      state.index = 0;
      refresh();
    },
    // Look through the answered questions again (answers are not changed).
    review() {
      state.phase = 'question';
      state.index = 0;
      refresh();
    },
    answer(k) {
      const q = questions[state.index];
      if (state.phase !== 'question' || state.answers[state.index] !== null || !(k >= 0 && k < q.choices.length)) return false;
      state.answers[state.index] = k;
      if (k === q.answer) state.right++;
      refresh();
      return k === q.answer;
    },
    next() {
      if (state.phase !== 'question' || state.answers[state.index] === null) return;
      if (state.index < total - 1) {
        state.index++;
      } else {
        state.phase = 'result';
        if (!state.done) {
          state.done = true;
          const score = { right: state.right, total };
          ensureStats(mission).fieldCheck = score;
          mission.log.add({
            title: `Field Check: ${state.right} / ${total}`,
            lines: [`${state.right} of ${total} right on the first try. No penalty.`],
            station: 'S5',
          });
          if (fieldCheck.onDone) fieldCheck.onDone(score);
        }
      }
      refresh();
    },
  };
  return fieldCheck;
}
