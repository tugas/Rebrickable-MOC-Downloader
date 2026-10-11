const query = new URLSearchParams(location.search);
const jobId = query.get("job");
const mocId = document.querySelector("#moc-id");
const summary = document.querySelector("#summary");
const count = document.querySelector("#count");
const percent = document.querySelector("#percent");
const bar = document.querySelector("#bar");
const items = document.querySelector("#items");
const notice = document.querySelector("#notice");

function render(job) {
  if (!job) {
    summary.textContent = "Could not find this job.";
    notice.textContent = "Close this tab and start again from the extension.";
    return;
  }

  mocId.textContent = job.mocId;
  summary.textContent = job.status;
  const total = job.total || 0;
  const completed = job.current || 0;
  const value = total ? Math.round((completed / total) * 100) : 0;
  count.textContent = total ? `${completed} of ${total}` : "Counting files";
  percent.textContent = `${value}%`;
  bar.style.width = `${value}%`;
  items.replaceChildren();

  for (const item of job.items || []) {
    const row = document.createElement("li");
    const name = document.createElement("span");
    const state = document.createElement("span");
    name.textContent = item.name;
    state.textContent = item.state;
    row.append(name, state);
    items.append(row);
  }

  if (job.error) {
    notice.textContent = job.error;
  } else if (job.done) {
    notice.textContent = "ZIP created. Check the package in Firefox's downloads list.";
  } else {
    notice.textContent = "Collecting files from the active page and creating the ZIP. This panel updates automatically.";
  }
}

async function refresh() {
  if (!jobId) {
    render(null);
    return;
  }
  const result = await browser.runtime.sendMessage({ type: "get-job", jobId });
  render(result?.job);
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "job-updated" && message.jobId === jobId) render(message.job);
});

refresh();
window.setInterval(refresh, 2000);
