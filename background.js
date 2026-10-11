const jobs = new Map();

function updateJob(jobId, update) {
  const job = jobs.get(jobId);
  if (!job) return;
  Object.assign(job, update, { updatedAt: Date.now() });
  browser.runtime.sendMessage({ type: "job-updated", jobId, job }).catch(() => {});
}

async function startJob(message) {
  const tabMatch = message.tabUrl?.match(/^https:\/\/rebrickable\.com\/mocs\/(MOC-\d+)(?:\/|$)/i);
  if (!message.tabId || !tabMatch || tabMatch[1].toUpperCase() !== message.mocId) {
    return { ok: false, error: "The active tab is not a Rebrickable MOC page." };
  }

  const jobId = `${message.mocId}-${Date.now()}`;
  const job = {
    jobId,
    mocId: message.mocId,
    status: "Preparing the active MOC page…",
    current: 0,
    total: 0,
    items: [],
    done: false,
    error: "",
    updatedAt: Date.now(),
  };
  jobs.set(jobId, job);

  const progressTab = await browser.tabs.create({
    url: browser.runtime.getURL(`progress.html?job=${encodeURIComponent(jobId)}`),
    active: true,
  });
  job.progressTabId = progressTab.id;
  job.mocTabId = message.tabId;
  job.includeInstructions = Boolean(message.includeInstructions);
  job.includeHtml = Boolean(message.includeHtml);
  await initializeMocTab(job);
  return { ok: true, jobId };
}

async function initializeMocTab(job) {
  if (job.initialized) return;
  job.initialized = true;
  try {
    await browser.tabs.executeScript(job.mocTabId, { file: "content.js" });
    await browser.tabs.sendMessage(job.mocTabId, { type: "prepare-moc-page", jobId: job.jobId });
  } catch (error) {
    updateJob(job.jobId, { done: true, error: error.message, status: "Could not start on the MOC page." });
  }
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "start-download") return startJob(message);

  if (message?.type === "get-job") {
    return Promise.resolve({ job: jobs.get(message.jobId) || null });
  }

  if (message?.type === "page-download-update") {
    const job = jobs.get(message.jobId);
    if (!job || sender.tab?.id !== job.mocTabId) return undefined;
    updateJob(message.jobId, message.update);
    if (message.update.done && job.progressTabId) {
      browser.tabs.update(job.progressTabId, { active: true }).catch(() => {});
    }
    return undefined;
  }

  if (message?.type === "moc-page-ready") {
    const job = jobs.get(message.jobId);
    if (!job || sender.tab?.id !== job.mocTabId) return undefined;
    browser.tabs.sendMessage(job.mocTabId, {
      type: "download-moc",
      jobId: job.jobId,
      mocId: job.mocId,
      includeInstructions: job.includeInstructions,
      includeHtml: job.includeHtml,
    }).catch((error) => updateJob(job.jobId, { done: true, error: error.message, status: "Failed to start." }));
    return undefined;
  }

  return undefined;
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  const job = [...jobs.values()].find((item) => item.mocTabId === tabId);
  if (!job) return;
  if (!tab.url?.startsWith("https://rebrickable.com/mocs/")) {
    const blocked = /\/login\//i.test(tab.url || "")
      ? "Rebrickable redirected to the login page. Sign in to Firefox and start the download again."
      : "The MOC page was blocked or redirected. Check the Rebrickable tab and try again.";
    updateJob(job.jobId, { done: true, error: blocked, status: "Could not load the MOC." });
    return;
  }
  await initializeMocTab(job);
});
