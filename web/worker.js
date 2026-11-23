// Web Worker da simulação: o motor roda aqui para não disputar a thread do desenho.
import { makeHost } from "./engine/host.js";
import { runBenchmarks, DEFAULT_SIZES } from "./engine/benchmarks.js";

const onMessage = makeHost((msg, transfer) => self.postMessage(msg, transfer || []));

self.onmessage = (ev) => {
  const msg = ev.data;
  if (msg && msg.type === "bench") {
    // benchmark num worker próprio (ver app.js), então a cidade não para
    try {
      const r = runBenchmarks(msg.sizes || DEFAULT_SIZES, 7, (i, n, name) => self.postMessage({ type: "bench-progress", i, n, name }));
      self.postMessage({ type: "bench-done", result: r });
    } catch (e) { self.postMessage({ type: "bench-error", error: String(e && e.message || e) }); }
    return;
  }
  onMessage(msg);
};
self.postMessage({ type: "boot" });
