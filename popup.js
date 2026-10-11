const status = document.querySelector("#status");
const button = document.querySelector("#download");
const currentMoc = document.querySelector("#current-moc");
const includeHtml = document.querySelector("#include-html");

browser.storage.local.get({ includeHtml: false }).then((settings) => {
  includeHtml.checked = settings.includeHtml;
});

includeHtml.addEventListener("change", () => {
  browser.storage.local.set({ includeHtml: includeHtml.checked });
});

let activeTab = null;

browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  activeTab = tab;
  const match = tab?.url?.match(/^https:\/\/rebrickable\.com\/mocs\/(MOC-\d+)(?:\/|$)/i);
  currentMoc.textContent = match
    ? `MOC detected in this tab: ${match[1].toUpperCase()}`
    : "Open a Rebrickable MOC page to get started.";
  button.disabled = !match;
});

function setStatus(message) {
  status.textContent = message;
}

button.addEventListener("click", async () => {
  const match = activeTab?.url?.match(/^https:\/\/rebrickable\.com\/mocs\/(MOC-\d+)(?:\/|$)/i);
  if (!match || !activeTab?.id) {
    setStatus("The active tab is not a Rebrickable MOC page.");
    return;
  }
  const mocId = match[1].toUpperCase();

  button.disabled = true;
  try {
    const result = await browser.runtime.sendMessage({
      type: "start-download",
      mocId,
      tabId: activeTab.id,
      tabUrl: activeTab.url,
      includeInstructions: document.querySelector("#include-instructions").checked,
      includeHtml: includeHtml.checked,
    });
    if (!result?.ok) throw new Error(result?.error || "Could not start the downloads.");
    setStatus("Progress tab opened.");
  } catch (error) {
    setStatus(error.message || String(error));
  } finally {
    button.disabled = false;
  }
});
