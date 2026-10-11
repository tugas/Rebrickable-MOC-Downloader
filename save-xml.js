const jobId = new URLSearchParams(location.search).get("job");
const status = document.querySelector("#status");

(async () => {
  try {
    const payload = await browser.runtime.sendMessage({ type: "get-xml-payload", jobId });
    if (!payload?.base64 || !payload.filename) throw new Error("The XML is not available to save.");

    const binary = atob(payload.base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const blob = new Blob([bytes], { type: payload.mimeType || "application/xml;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    await browser.downloads.download({ url: blobUrl, filename: payload.filename, saveAs: false });
    status.textContent = "BrickLink XML saved.";
    await browser.runtime.sendMessage({ type: "xml-save-finished", jobId, ok: true });
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  } catch (error) {
    status.textContent = error.message || String(error);
    await browser.runtime.sendMessage({ type: "xml-save-finished", jobId, ok: false, error: status.textContent });
  }
})();
