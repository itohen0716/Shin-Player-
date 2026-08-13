(() => {
  "use strict";

  const aliases = Object.freeze({
    hon: "hon", niage: "niage", sansage: "sansage",
    honchoshi: "hon", niagari: "niage", sansagari: "sansage"
  });
  const embeddedDocument = window.ShianEmbeddedAssets?.tuningMaster;
  const documentReady = embeddedDocument
    ? Promise.resolve(embeddedDocument)
    : Promise.reject(new Error("同梱された調弦マスターデータが見つかりません。"));

  window.ShianTuningMasterReady = documentReady
    .then((documentData) => {
      if (!Array.isArray(documentData.entries) || documentData.entries.length !== 36) {
        throw new Error("調弦マスターデータの件数が不正です。");
      }
      const entries = Object.freeze(documentData.entries.map((entry) => {
        const frequencies = entry.frequencies.map(Number);
        if (frequencies.length !== 3 || frequencies.some((value) => !Number.isFinite(value) || value <= 0)) {
          throw new Error("調弦マスターデータに不正な周波数があります。");
        }
        return Object.freeze({ ...entry, frequencies: Object.freeze(frequencies) });
      }));
      const byKey = Object.freeze(Object.fromEntries(entries.map((entry) => [`${entry.count}:${entry.mode}`, entry])));
      const master = Object.freeze({
        version: documentData.version,
        source: documentData.source,
        columns: Object.freeze([...documentData.columns]),
        entries,
        get(count, mode) {
          const normalized = aliases[mode] || "hon";
          return byKey[`${Math.max(1, Math.min(12, Number(count) || 1))}:${normalized}`];
        },
        formatHz(frequency) { return `${Number(frequency).toFixed(1)} Hz`; }
      });
      window.ShianTuningMaster = master;
      return master;
    })
    .catch((error) => {
      console.error(error);
      window.dispatchEvent(new CustomEvent("shian-tuning-data-error", { detail: error }));
      throw error;
    });
})();
