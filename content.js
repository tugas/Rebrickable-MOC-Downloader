let activeJobId = null;

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "prepare-moc-page") {
    activeJobId = message.jobId;
    browser.runtime.sendMessage({ type: "moc-page-ready", jobId: activeJobId });
    return undefined;
  }

  if (message?.type !== "download-moc") return undefined;

  activeJobId = message.jobId;
  const requestedId = String(message.mocId || "").toUpperCase();
  const pageMatch = location.pathname.match(/\/mocs\/(MOC-\d+)/i);
  if (!pageMatch || pageMatch[1].toUpperCase() !== requestedId) {
    report({ done: true, error: `The open page does not match ${requestedId}.`, status: "MOC ID does not match the page." });
    return undefined;
  }

  report({ current: 0, total: 0, items: [], status: "Waiting for the inventory and exports to load…" });
  waitForExports(message.includeHtml)
    .then((exportLinks) => startExports(exportLinks, message))
    .catch((error) => report({ done: true, error: error.message, status: "Could not find the exports." }));
  return undefined;
});

async function waitForExports(includeHtml) {
  const inventoryTab = document.querySelector('a[href="#tab_parts"]');
  const hasPartExports = () => document.querySelector('a[href*="/inventory/"][href*="format=rbpartscsv"]');
  if (inventoryTab && !hasPartExports()) inventoryTab.click();

  const exportMenu = [...document.querySelectorAll("button")].find((button) => /Export Parts/i.test(button.textContent));
  if (exportMenu && exportMenu.getAttribute("aria-expanded") !== "true") exportMenu.click();

  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const links = [...document.querySelectorAll('a[href*="/inventory/"][href*="format="]')];
    const requiredFormats = ["rbpartscsv", "legopab", "bsbsx", "ldcadpbg"];
    if (includeHtml) requiredFormats.push("table", "grid");
    const formatsPresent = requiredFormats
      .every((format) => links.some((anchor) => new URL(anchor.href).searchParams.get("format") === format));
    const bricklinkPresent = [...document.querySelectorAll('a[data-url*="format=blxml"]')].length > 0;
    if (formatsPresent && bricklinkPresent) return links;
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
  throw new Error("The inventory did not show all exports within 45 seconds. Check your login, any security checks, and MOC availability.");
}

async function startExports(exportLinks, message) {
  const formats = [
    { format: "rbpartscsv", name: "Rebrickable CSV", filename: "parts-rebrickable.csv" },
    { format: "legopab", name: "LEGO Pick-A-Brick CSV", filename: "parts-lego-pick-a-brick.csv" },
    { format: "blxml", name: "BrickLink XML", filename: "parts-bricklink.xml", modal: true },
    { format: "bsbsx", name: "BrickStore BSX", filename: "parts-brickstore.bsx" },
    { format: "ldcadpbg", name: "LDCad PBG", filename: "parts-ldcad.pbg" },
  ];
  if (message.includeHtml) {
    formats.push(
      { format: "table", name: "HTML Table", filename: "parts-table.html" },
      { format: "grid", name: "HTML Grid", filename: "parts-grid.html" },
    );
  }
  const links = formats.map((item) => ({
    ...item,
    link: item.modal
      ? document.querySelector('a[data-url*="format=blxml"]')
      : exportLinks.find((anchor) => new URL(anchor.href).searchParams.get("format") === item.format),
  }));
  const missing = links.filter((item) => !item.link).map((item) => item.name);
  if (missing.length) {
    report({ done: true, error: `Could not find: ${missing.join(", ")}.`, status: "Exports not found on the page." });
    return undefined;
  }

  const instructionParagraph = [...document.querySelectorAll("p")]
    .find((paragraph) => /Download the free Building Instructions/i.test(paragraph.textContent));
  const instructionContainer = instructionParagraph?.nextElementSibling;
  const instructionLinks = instructionContainer
    ? [...instructionContainer.querySelectorAll('a[href]')]
      .map((anchor) => {
        const filename = anchor.querySelector("[title]")?.title || anchor.title || anchor.textContent.trim();
        const url = /\/mocs\/purchases\/download\//.test(new URL(anchor.href).pathname)
          ? anchor.href
          : anchor.dataset.url && /\/mocs\/\d+\/files\/\d+\//.test(anchor.dataset.url)
            ? new URL(anchor.dataset.url, location.origin).href
            : null;
        return { href: url, filename };
      })
      .filter((item) => item.href && item.filename)
    : [];
  if (message.includeInstructions) {
    for (const [index, instruction] of instructionLinks.entries()) {
      formats.push({
        name: `Building Instructions ${index + 1}`,
        filename: sanitizeFilename(instruction.filename),
        instructionUrl: instruction.href,
      });
    }
  }

  const queue = [...links, ...formats.slice(links.length).map((item) => ({ ...item, link: null }))];
  const items = queue.map((item) => ({ name: item.name, state: "Waiting" }));
  const fileErrors = [];
  const files = [];
  report({ current: 0, total: queue.length + 1, items, status: "Collecting exports and instructions for the ZIP…" });

  for (let index = 0; index < queue.length; index += 1) {
    if (index > 0) await new Promise((resolve) => window.setTimeout(resolve, 15000));
    const item = queue[index];
    report({ current: index, total: queue.length + 1, items, status: `Processing ${index + 1} of ${queue.length}: ${item.name}` });

    try {
      const sourceUrl = item.instructionUrl || (item.modal
        ? new URL(item.link.dataset.url, location.origin).href
        : item.link.href);
      const blob = item.modal
        ? await fetchBricklinkXml(item.link)
        : await fetchExport(sourceUrl, item.filename);
      files.push({ filename: item.filename, data: new Uint8Array(await blob.arrayBuffer()) });
      items[index].state = "Adicionado ao ZIP";
      items[index].sourceUrl = sourceUrl;
    } catch (error) {
      fileErrors.push(`${item.name}: ${error.message}`);
      items[index].state = "Falhou";
      items[index].error = error.message;
      items[index].sourceUrl = item.instructionUrl || (item.link
        ? item.modal ? new URL(item.link.dataset.url, location.origin).href : item.link.href
        : "Unavailable");
      if (error.rateLimited) {
        report({ current: index, total: queue.length + 1, items, done: true, error: error.message, status: "Queue stopped by Rebrickable's rate limit." });
        return;
      }
      report({ current: index + 1, total: queue.length + 1, items, error: error.message, status: `${item.name} falhou; a continuar.` });
    }
    report({ current: index + 1, total: queue.length + 1, items, status: `File ${index + 1} of ${queue.length}: ${item.name}` });
  }

  if (!files.length) {
    report({ current: queue.length, total: queue.length + 1, items, done: true, error: "No exports were downloaded; no ZIP was created.", status: "No files to package." });
    return;
  }

  const zipFilename = getZipFilename(message.mocId);
  files.push({
    filename: "source-details.txt",
    data: new TextEncoder().encode(makeSourceDetails(message.mocId, queue, items)),
  });
  items.push({ name: zipFilename, state: "Creating ZIP" });
  report({ current: queue.length, total: queue.length + 1, items, status: "Creating ZIP…" });
  const zipBlob = makeZip(files);
  const zipUrl = URL.createObjectURL(zipBlob);
  const downloadLink = document.createElement("a");
  downloadLink.href = zipUrl;
  downloadLink.download = zipFilename;
  downloadLink.style.display = "none";
  document.body.append(downloadLink);
  downloadLink.click();
  downloadLink.remove();
  window.setTimeout(() => URL.revokeObjectURL(zipUrl), 120000);
  items[items.length - 1].state = "Saved";
  report({
    current: queue.length + 1,
    total: queue.length + 1,
    items,
    done: true,
    error: fileErrors.join(" "),
    status: `ZIP ${zipFilename} created with ${files.length} files${fileErrors.length ? `; ${fileErrors.length} file(s) failed` : ""}.`,
  });
}

function makeSourceDetails(mocId, queue, items) {
  const title = document.querySelector("h1")?.textContent.trim() || document.title.trim() || "Unavailable";
  const description = document.querySelector('meta[name="description"]')?.content.trim() || "Unavailable";
  const inventorySummary = [...document.querySelectorAll("p")]
    .find((paragraph) => /approximate cost of these parts is/i.test(paragraph.textContent))
    ?.textContent.trim() || "Unavailable";
  const lines = [
    "Rebrickable MOC download details",
    "",
    `MOC ID: ${mocId}`,
    `Title: ${title}`,
    `Page URL: ${location.href}`,
    `Description: ${description}`,
    `Inventory details: ${inventorySummary}`,
    "",
    "Files and source URLs:",
  ];

  queue.forEach((item, index) => {
    lines.push(`- ${item.filename} (${items[index].state})`);
    lines.push(`  Source: ${items[index].sourceUrl || "Unavailable"}`);
    if (items[index].error) lines.push(`  Error: ${items[index].error}`);
  });

  return `${lines.join("\n")}\n`;
}

function getZipFilename(mocId) {
  const inventorySummary = [...document.querySelectorAll("p")]
    .find((paragraph) => /approximate cost of these parts is/i.test(paragraph.textContent));
  const costMatch = inventorySummary?.textContent.match(/approximate cost of these parts is\s*([€$£])\s*([\d.,]+)/i);
  if (!costMatch) return `${mocId}.zip`;

  const currency = { "€": "EUR", "$": "USD", "£": "GBP" }[costMatch[1]];
  const amount = costMatch[2].replace(/,/g, "_");
  return `${mocId}_${currency}-${amount}.zip`;
}

async function fetchBricklinkXml(link) {
  const endpoint = new URL(link.dataset.url, location.origin);
  const response = await fetch(endpoint.href, { credentials: "same-origin", redirect: "follow" });
  if (response.status === 429) {
    const error = new Error("Rebrickable returned HTTP 429. The queue was stopped; wait before trying again.");
    error.rateLimited = true;
    throw error;
  }
  if (!response.ok) throw new Error(`BrickLink XML respondeu HTTP ${response.status}.`);
  if (new URL(response.url).pathname.startsWith("/login/")) {
    throw new Error("BrickLink XML requires an authenticated session. Sign in to Rebrickable in this tab and start the downloads again.");
  }
  const payload = await response.json();
  if (typeof payload.html !== "string") throw new Error("Rebrickable did not return the expected BrickLink XML panel.");
  const modalDocument = new DOMParser().parseFromString(payload.html, "text/html");
  const xml = modalDocument.querySelector("#xml_code")?.value?.trim();
  if (!xml || !/^<INVENTORY(?:\s|>)/i.test(xml)) {
    throw new Error("The Rebrickable panel did not contain valid BrickLink XML.");
  }
  return new Blob([xml], { type: "application/xml;charset=utf-8" });
}

async function fetchExport(url, filename) {
  const response = await fetch(url, { credentials: "same-origin", redirect: "follow" });
  if (response.status === 429) {
    const error = new Error("Rebrickable returned HTTP 429. The queue was stopped; wait before trying again.");
    error.rateLimited = true;
    throw error;
  }
  if (!response.ok) throw new Error(`${filename}: HTTP ${response.status}.`);
  if (new URL(response.url).pathname.startsWith("/login/")) throw new Error(`${filename}: a Rebrickable session is required.`);
  const blob = await response.blob();
  if (blob.size === 0) throw new Error(`${filename}: export is empty.`);
  const contentType = response.headers.get("content-type") || "";
  if (/\/mocs\/purchases\/download\//.test(new URL(url).pathname)
      && (contentType.includes("text/html") || contentType.includes("application/json"))) {
    throw new Error(`${filename}: Rebrickable requires manual verification; the content was not included in the ZIP.`);
  }
  return blob;
}

function sanitizeFilename(filename) {
  return filename.replace(/[\\/:*?"<>|]/g, "_").trim() || "building-instructions";
}

function makeZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const crcTable = makeCrcTable();

  for (const file of files) {
    const name = encoder.encode(file.filename);
    const data = file.data;
    const crc = crc32(data, crcTable);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
}

function makeCrcTable() {
  return Array.from({ length: 256 }, (_, value) => {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    return crc >>> 0;
  });
}

function crc32(bytes, table) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function report(update) {
  if (!activeJobId) return;
  browser.runtime.sendMessage({ type: "page-download-update", jobId: activeJobId, update }).catch(() => {});
}
