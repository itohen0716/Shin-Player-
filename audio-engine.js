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
  const traceEntries = [];
  const TRACE_LIMIT = 5000;
  const SOURCE_CONFIGS = Object.freeze({
    normal: Object.freeze({
      url: "./audio/teacher-1to12-octave.wav",
      label: "三味線音源"
    }),
    hajiki: Object.freeze({
      url: "./audio/shamisen-hajiki.wav",
      label: "ハジキ音源"
    })
  });
  let nextTraceId = 1;
  let context;
  const audioBuffers = new Map();
  const loadPromises = new Map();

  function trace(type, details = {}) {
    const entry = Object.freeze({
      type,
      recordedAtMs: typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now(),
      contextTime: context?.currentTime ?? null,
      ...details
    });
    traceEntries.push(entry);
    if (traceEntries.length > TRACE_LIMIT) traceEntries.splice(0, traceEntries.length - TRACE_LIMIT);
    return entry;
  }

  function getTrace() {
    return traceEntries.map((entry) => ({ ...entry }));
  }

  function clearTrace() {
    traceEntries.length = 0;
    nextTraceId = 1;
  }

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

  function normalizeSourceKind(value) {
    return value === "hajiki" ? "hajiki" : "normal";
  }

  function load(sourceKind = "normal") {
    const normalizedKind = normalizeSourceKind(sourceKind);
    const config = SOURCE_CONFIGS[normalizedKind];
    const loadedBuffer = audioBuffers.get(normalizedKind);
    if (loadedBuffer) return Promise.resolve(loadedBuffer);
    const pendingLoad = loadPromises.get(normalizedKind);
    if (pendingLoad) return pendingLoad;
    const promise = (async () => {
      const ctx = await resume();
      let response;
      try {
        response = await fetch(config.url, { cache: "force-cache" });
      } catch (_) {
        throw new Error(`${config.label}を読み込めませんでした。通信状態を確認してください。`);
      }
      if (!response.ok) throw new Error(`${config.label}を読み込めませんでした（${response.status}）。`);
      const audioData = await response.arrayBuffer();
      if (!audioData.byteLength) throw new Error(`${config.label}のデータが空です。`);
      let decodedBuffer;
      try {
        decodedBuffer = await ctx.decodeAudioData(audioData);
      } catch (_) {
        throw new Error(`${config.label}を再生用に変換できませんでした。`);
      }
      audioBuffers.set(normalizedKind, decodedBuffer);
      trace("buffer-loaded", {
        sourceKind: normalizedKind,
        sourceUrl: config.url,
        bufferDuration: decodedBuffer.duration,
        sampleRate: decodedBuffer.sampleRate
      });
      return decodedBuffer;
    })().catch((error) => {
      loadPromises.delete(normalizedKind);
      throw error;
    });
    loadPromises.set(normalizedKind, promise);
    return promise;
  }

  function stopVoice(voice, fadeSeconds = 0.02) {
    if (!voice || voice.stopped) return;
    voice.stopped = true;
    active.delete(voice);
    const now = voice.context.currentTime;
    trace("voice-stop-request", {
      traceId: voice.traceId ?? null,
      requestedAt: now,
      stopAt: now + fadeSeconds,
      fadeSeconds
    });
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
    const sourceKind = normalizeSourceKind(options.sourceKind);
    const segment = typeof segmentOrNumber === "number"
      ? window.ShianSoundSegments?.[segmentOrNumber]
      : segmentOrNumber;
    if (!segment || !Number.isFinite(segment.start) || !Number.isFinite(segment.end)) {
      throw new Error("音源区間が見つかりません。");
    }

    const ctx = await resume();
    const audioBuffer = await load(sourceKind);
    if (options.exclusive !== false) stopAll(0.01);

    const offset = Math.max(0, segment.start);
    const sourceDuration = Math.max(0.05, Math.min(segment.end, audioBuffer.duration) - offset);
    const rate = Math.max(0.25, Math.min(4, Number(options.playbackRate) || 1));
    const availableDuration = sourceDuration / rate;
    const requestedDuration = Number(options.duration);
    const outputDuration = Number.isFinite(requestedDuration) && requestedDuration > 0
      ? Math.min(requestedDuration, availableDuration)
      : availableDuration;
    const sourcePlaybackDuration = Math.min(sourceDuration, outputDuration * rate);
    const startDelay = Math.max(0, Number(options.delay) || 0);
    const absoluteWhen = Number(options.when);
    const startAt = Number.isFinite(absoluteWhen) ? absoluteWhen : ctx.currentTime + startDelay;
    const defaultFadeIn = sourceKind === "hajiki"
      ? Math.min(0.003, outputDuration / 10)
      : Math.min(0.018, outputDuration / 5);
    const defaultFadeOut = sourceKind === "hajiki"
      ? Math.min(0.004, outputDuration / 10)
      : Math.min(0.018, outputDuration / 5);
    const requestedFadeIn = Number(options.fadeInSeconds);
    const requestedFadeOut = Number(options.fadeOutSeconds);
    const fadeIn = Number.isFinite(requestedFadeIn) && requestedFadeIn > 0
      ? Math.min(requestedFadeIn, outputDuration / 5)
      : defaultFadeIn;
    const fadeOut = Number.isFinite(requestedFadeOut) && requestedFadeOut > 0
      ? Math.min(requestedFadeOut, outputDuration / 5)
      : defaultFadeOut;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const traceId = nextTraceId;
    nextTraceId += 1;
    const traceContext = options.traceContext && typeof options.traceContext === "object"
      ? { ...options.traceContext }
      : {};
    const voice = { source, gain, context: ctx, stopped: false, traceId };

    source.buffer = audioBuffer;
    if (sourceKind === "hajiki" && typeof source.playbackRate.setValueAtTime === "function") {
      source.playbackRate.setValueAtTime(rate, startAt);
    } else {
      source.playbackRate.value = rate;
    }
    const destination = options.destination && typeof options.destination.connect === "function"
      ? options.destination
      : ctx.destination;
    source.connect(gain).connect(destination);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(Number(options.volume) || 0.9, startAt + fadeIn);
    gain.gain.setValueAtTime(Number(options.volume) || 0.9, startAt + Math.max(fadeIn, outputDuration - fadeOut));
    gain.gain.linearRampToValueAtTime(0.0001, startAt + outputDuration);
    source.addEventListener("ended", () => {
      active.delete(voice);
      trace("source-ended", {
        traceId,
        scheduledStart: startAt,
        scheduledStop: startAt + outputDuration,
        endedAt: ctx.currentTime,
        ...traceContext
      });
      try { source.disconnect(); gain.disconnect(); } catch (_) {}
    }, { once: true });
    active.add(voice);
    trace("source-scheduled", {
      traceId,
      sourceKind,
      sourceUrl: SOURCE_CONFIGS[sourceKind].url,
      scheduledAt: ctx.currentTime,
      startAt,
      stopAt: startAt + outputDuration,
      offset,
      segmentStart: segment.start,
      segmentEnd: segment.end,
      segmentDuration: sourceDuration,
      playbackRate: rate,
      requestedDuration: Number.isFinite(requestedDuration) ? requestedDuration : null,
      availableDuration,
      outputDuration,
      sourcePlaybackDuration,
      sourceStartCall: [startAt, offset, sourcePlaybackDuration],
      sourceStopCall: [startAt + outputDuration],
      fadeInSeconds: fadeIn,
      fadeOutSeconds: fadeOut,
      volume: Number(options.volume) || 0.9,
      schedulingLeadSeconds: startAt - ctx.currentTime,
      ...traceContext
    });
    source.start(startAt, offset, sourcePlaybackDuration);
    source.stop(startAt + outputDuration);

    return Object.freeze({
      duration: outputDuration,
      traceId,
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
    const sourceKind = normalizeSourceKind(options.sourceKind);
    const audioBuffer = await load(sourceKind);
    const sources = master.entries
      .filter((entry) => entry.mode === "hon")
      .flatMap((entry) => [
        { noteNumber: entry.count, frequency: entry.frequencies[0] },
        { noteNumber: entry.count + 12, frequency: entry.frequencies[0] * 2 }
      ])
      .filter((entry) => {
        const segment = window.ShianSoundSegments?.[entry.noteNumber];
        return segment && Number.isFinite(segment.start) && Number.isFinite(segment.end)
          && segment.end > segment.start && segment.start + 0.05 <= audioBuffer.duration;
      });
    if (!sources.length) {
      const label = SOURCE_CONFIGS[sourceKind].label;
      throw new Error(`${label}に対応する調弦データがありません。`);
    }
    const source = sources.reduce((best, candidate) =>
      Math.abs(Math.log2(target / candidate.frequency)) < Math.abs(Math.log2(target / best.frequency))
        ? candidate
        : best
    );
    return playSegment(source.noteNumber, {
      ...options,
      sourceKind,
      playbackRate: (Number(options.playbackRate) || 1) * target / source.frequency
    });
  }

  const api = Object.freeze({
    getContext,
    resume,
    load,
    play,
    playSegment,
    playFrequency,
    stop: stopAll,
    stopAll,
    getTrace,
    clearTrace
  });
  root.ShianAudioEngine = api;
  window.ShianAudioEngine = api;
})();
