/**
 * AgentStudio WebContainer 预览：将 iframe 内运行时错误通过 postMessage 发给父页面，
 * 便于「一键修复」把与 DevTools Console 同源的信息带给 AI。
 * 父窗口会校验 event.origin 须为当前预览 URL 同源。
 */
const MSG_TYPE = "agentstudio:preview-runtime";
const FLAG = "__AGENTSTUDIO_PREVIEW_BRIDGE__";

if (typeof window !== "undefined" && window.parent !== window && !window[FLAG]) {
  window[FLAG] = true;

  const send = (payload) => {
    try {
      window.parent.postMessage({ type: MSG_TYPE, ...payload }, "*");
    } catch {
      /* ignore */
    }
  };

  window.addEventListener(
    "error",
    (event) => {
      send({
        kind: "error",
        message: event.message || String(event.error || ""),
        stack: event.error?.stack || "",
        source: event.filename || "",
        line: event.lineno,
        col: event.colno,
        t: Date.now()
      });
    },
    true
  );

  window.addEventListener("unhandledrejection", (event) => {
    const r = event.reason;
    send({
      kind: "unhandledrejection",
      message: r && typeof r === "object" && "message" in r ? String(r.message) : String(r || ""),
      stack: r && typeof r === "object" && typeof r.stack === "string" ? r.stack : "",
      t: Date.now()
    });
  });
}
