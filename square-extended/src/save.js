// Progress and settings, persisted to localStorage when it is available.
// Storage can be missing or throw (private windows, blocked site data), so
// every access is guarded and the game works without it.
'use strict';
SQ.save = (() => {
  const KEY = 'square-extended-v1';
  const defaults = () => ({
    settings: { slowMode: false, showRange: true, sfx: true, music: true, shake: true, timer: true },
    cleared: {}, // levelId -> true
    best: {}, // levelId -> seconds
    deaths: 0,
    chapterDeaths: {},
    challenges: {}, // challengeId -> { done, best }
    arenas: {}, // arenaId -> { wave, score }
    finished: false,
  });
  let data = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const d = defaults();
      data = Object.assign(d, parsed);
      data.settings = Object.assign(d.settings, parsed.settings || {});
    }
  } catch (e) {
    /* storage unavailable: play without persistence */
  }
  const write = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      /* ignore */
    }
  };
  return {
    get data() {
      return data;
    },
    get settings() {
      return data.settings;
    },
    write,
    reset() {
      const s = data.settings;
      data = defaults();
      data.settings = s;
      write();
    },
    levelCleared(id, time) {
      data.cleared[id] = true;
      if (data.best[id] == null || time < data.best[id]) data.best[id] = time;
      write();
    },
    addDeath(chapterId) {
      data.deaths++;
      if (chapterId) data.chapterDeaths[chapterId] = (data.chapterDeaths[chapterId] || 0) + 1;
      write();
    },
  };
})();
