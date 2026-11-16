// Shared state for the mineral-sampling objective. Every mineral module reads
// and writes through this one object (mission.minerals) so they stay in step.
//
//   data       the parsed data/walk/<site>/minerals.json (null until loaded)
//   picks      up to three deposit ids chosen in the cabin
//   plan       result of planMineralRoute(picks) once three are confirmed, else null
//   confirmed  true once the player has confirmed three picks (door may open)
//   collected  [{ depositId, group }] in the order collected outside
//   shelved    deposit ids whose containers are on the cabin shelf
//   complete   true when every station is done and three containers are shelved
//
// Change events: 'data', 'picks', 'plan', 'confirmed', 'collected', 'shelved', 'complete'.

export const MINERAL_PICK_COUNT = 3;

export function createMineralState() {
  const listeners = new Set();
  const state = {
    data: null,
    picks: [],
    plan: null,
    confirmed: false,
    collected: [],
    shelved: [],
    complete: false,
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(kind) {
      for (const fn of listeners) {
        try {
          fn(kind, state);
        } catch (error) {
          console.error(error);
        }
      }
    },
    deposit(id) {
      return state.data?.deposits.find((d) => d.id === id) ?? null;
    },
    group(id) {
      return state.data?.groups.find((g) => g.id === id) ?? null;
    },
    isCollected(id) {
      return state.collected.some((c) => c.depositId === id);
    },
    isShelved(id) {
      return state.shelved.includes(id);
    },
  };
  return state;
}

export function ensureMineralState(mission) {
  if (!mission.minerals) mission.minerals = createMineralState();
  return mission.minerals;
}
