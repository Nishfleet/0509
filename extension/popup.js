import { buildDestinations, domainFromInput, domainFromTabUrl } from "./lib/domain.mjs";

const mainView = document.getElementById("main-view");
const fallbackView = document.getElementById("fallback-view");

function openDestination(domain, dest) {
  const urls = buildDestinations(domain);
  chrome.tabs.create({ url: urls[dest] });
  window.close();
}

function showMainView(domain) {
  document.getElementById("domain-label").textContent = domain;
  document.getElementById("domain-headline").textContent = domain;
  document.getElementById("btn-ads").addEventListener("click", () => openDestination(domain, "ads"));
  document.getElementById("btn-search").addEventListener("click", () => openDestination(domain, "search"));
  document.getElementById("btn-watch").addEventListener("click", () => openDestination(domain, "watch"));
  mainView.hidden = false;
}

function showFallbackView() {
  const form = document.getElementById("fallback-form");
  const input = document.getElementById("domain-input");
  const error = document.getElementById("input-error");
  let requestedDest = "ads";

  for (const button of form.querySelectorAll("[data-dest]")) {
    button.addEventListener("click", () => {
      requestedDest = button.dataset.dest;
    });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const domain = domainFromInput(input.value);
    if (!domain) {
      error.hidden = false;
      input.focus();
      return;
    }
    openDestination(domain, requestedDest);
  });

  input.addEventListener("input", () => {
    error.hidden = true;
  });

  fallbackView.hidden = false;
  input.focus();
}

async function init() {
  let domain = null;
  try {
    // activeTab is granted by the user opening this popup; the URL of the
    // active tab is the only page data this extension ever reads.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    domain = domainFromTabUrl(tab?.url);
  } catch {
    domain = null;
  }

  if (domain) {
    showMainView(domain);
  } else {
    showFallbackView();
  }
}

init();
