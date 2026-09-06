(() => {
  "use strict";

  const root = (() => {
    try { return window.top && window.top.location.origin === location.origin ? window.top : window; }
    catch (_) { return window; }
  })();
  if (root !== window && root.ShianAudioEngine) {
    window.ShianAudioEngine = root.ShianAudioEngine;
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const active = new Set();
  let context;
  let teacherBuffer;
  let loadPromise;

  function getContext() {
    if (!AudioContextClass) throw new Error("このブラウザーはWeb Audio APIに対応していません。");
    if (!context || context.state === "closed") context = new AudioContextClass({ latencyHint: "interactive" });
    return context;
  }

  async function resume() {
    const ctx = getContext();
    if (ctx.state === "suspended") await ctx.resume();
    return ctx;
  }

  function load() {
    if (teacherBuffer) return Promise.resolve(teacherBuffer);
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const ctx = await resume();
      let response;
      try {
        response = await fetch("./audio/teacher-1to12-octave.wav", { cache: "force-cache" });
      } catch (_) {
        throw new Error("三味線音源を読み込めませんでした。通信状態を確認してください。");
      }
      if (!response.ok) throw new Error(`三味線音源を読み込めませんでした（${response.status}）。`);
      const audioData = await response.arrayBuffer();
      if (!audioData.byteLength) throw new Error("三味線音源のデータが空です。");
      try {
        teacherBuffer = await ctx.decodeAudioData(audioData);
      } catch (_) {
        throw new Error("三味線音源を再生用に変換できませんでした。");
      }
      return teacherBuffer;
    })().catch((error) => {
      loadPromise = null;
      throw error;
    });
    return loadPromise;
  }

  function stopVoice(voice, fadeSeconds = 0.02) {
    if (!voice || voice.stopped) return;
    voice.stopped = true;
    active.delete(voice);
    const now = voice.context.currentTime;
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0.0001, now, Math.max(0.001, fadeSeconds / 3));
      voice.source.stop(now + fadeSeconds);
    } catch (_) {}
  }

  function stopAll(fadeSeconds = 0.02) {
    [...active].forEach((voice) => stopVoice(voice, fadeSeconds));
  }

  async function playSegment(segmentOrNumber, options = {}) {
    const segment = typeof segmentOrNumber === "number"
      ? window.ShianSoundSegments?.[segmentOrNumber]
      : segmentOrNumber;
    if (!segment || !Number.isFinite(segment.start) || !Number.isFinite(segment.end)) {
      throw new Error("音源区間が見つかりません。");
    }

    const ctx = await resume();
    const audioBuffer = await load();
    if (options.exclusive !== false) stopAll(0.01);

    const offset = Math.max(0, segment.start);
    const sourceDuration = Math.max(0.05, Math.min(segment.end, audioBuffer.duration) - offset);
    const rate = Math.max(0.25, Math.min(4, Number(options.playbackRate) || 1));
    const outputDuration = sourceDuration / rate;
    const startDelay = Math.max(0, Number(options.delay) || 0);
    const startAt = ctx.currentTime + startDelay;
    const fade = Math.min(0.018, outputDuration / 5);
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const voice = { source, gain, context: ctx, stopped: false };

    source.buffer = audioBuffer;
    source.playbackRate.value = rate;
    const destination = options.destination && typeof options.destination.connect === "function"
      ? options.destination
      : ctx.destination;
    source.connect(gain).connect(destination);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(Number(options.volume) || 0.9, startAt + fade);
    gain.gain.setValueAtTime(Number(options.volume) || 0.9, startAt + Math.max(fade, outputDuration - fade));
    gain.gain.linearRampToValueAtTime(0.0001, startAt + outputDuration);
    source.addEventListener("ended", () => {
      active.delete(voice);
      try { source.disconnect(); gain.disconnect(); } catch (_) {}
    }, { once: true });
    active.add(voice);
    source.start(startAt, offset, sourceDuration);

    return Object.freeze({
      duration: outputDuration,
      stop: () => stopVoice(voice),
      ended: new Promise((resolve) => source.addEventListener("ended", resolve, { once: true }))
    });
  }

  async function play(noteNumber, options) {
    const voice = await playSegment(noteNumber, options);
    return voice.duration;
  }

  async function playFrequency(frequency, options = {}) {
    const target = Number(frequency);
    const master = window.ShianTuningMaster;
    if (!Number.isFinite(target) || !master) throw new Error("調弦データから音を取得できません。");
    const sources = master.entries
      .filter((entry) => entry.mode === "hon")
      .flatMap((entry) => [
        { noteNumber: entry.count, frequency: entry.frequencies[0] },
        { noteNumber: entry.count + 12, frequency: entry.frequencies[0] * 2 }
      ]);
    if (!sources.length) throw new Error("先生音源に対応する調弦データがありません。");
    const source = sources.reduce((best, candidate) =>
      Math.abs(Math.log2(target / candidate.frequency)) < Math.abs(Math.log2(target / best.frequency))
        ? candidate
        : best
    );
    return playSegment(source.noteNumber, {
      ...options,
      playbackRate: (Number(options.playbackRate) || 1) * target / source.frequency
    });
  }

  const api = Object.freeze({ getContext, resume, load, play, playSegment, playFrequency, stop: stopAll, stopAll });
  root.ShianAudioEngine = api;
  window.ShianAudioEngine = api;
})();
