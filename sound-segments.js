(() => {
  "use strict";
  // teacher-1to12-octave.wav 内の24音。前半が1〜12本、後半が1オクターブ上。
  const starts = [0,3.430,6.863,10.294,13.717,17.151,20.574,24.008,27.438,30.861,34.286,37.718,41.144,44.573,48.007,51.435,54.870,58.306,61.732,65.156,68.584,72.009,75.434,78.871];
  const ends = [.691,4.525,7.882,10.935,14.826,18.138,21.311,24.569,28.275,31.558,35.329,38.730,41.899,45.639,48.742,52.285,56.193,59.221,62.333,65.917,69.318,72.786,76.123,79.589];
  const segments = {};
  starts.forEach((start, index) => {
    segments[index + 1] = Object.freeze({ start, end: ends[index], noteNumber: index + 1 });
  });
  window.ShianSoundSegments = Object.freeze(segments);
})();
