const checksElement = document.getElementById("checks");
const checksSummaryElement = document.getElementById("checks-summary");
const runCheckButton = document.getElementById("run-check");
const browsePathButton = document.getElementById("browse-path");
const prepareButton = document.getElementById("prepare-install");
const startInstallButton = document.getElementById("start-install");
const cancelInstallButton = document.getElementById("cancel-install");
const startDevHubButton = document.getElementById("start-devhub");
const stopDevHubButton = document.getElementById("stop-devhub");
const devHubLinkElement = document.getElementById("devhub-link");
const formElement = document.getElementById("settings-form");
const resultPanelElement = document.getElementById("result-panel");
const resultStatusElement = document.getElementById("result-status");
const warningsElement = document.getElementById("warnings");
const filesElement = document.getElementById("files");
const commandsElement = document.getElementById("commands");
const installPanelElement = document.getElementById("install-panel");
const installStatusElement = document.getElementById("install-status");
const installProgressElement = document.getElementById("install-progress");
const installLogElement = document.getElementById("install-log");

const installPathInput = document.getElementById("install-path");
const repoUrlInput = document.getElementById("repo-url");
const cloudProviderInput = document.getElementById("cloud-provider");
const cloudBaseUrlInput = document.getElementById("cloud-base-url");

let checksState = [];
let activeRunId = null;
let activeDevHubRunId = null;

runCheckButton.addEventListener("click", runSystemCheck);
browsePathButton.addEventListener("click", selectInstallPath);
prepareButton.addEventListener("click", prepareInstall);
startInstallButton.addEventListener("click", startInstall);
cancelInstallButton.addEventListener("click", cancelInstall);
startDevHubButton.addEventListener("click", startDevHub);
stopDevHubButton.addEventListener("click", stopDevHub);
cloudProviderInput.addEventListener("change", syncCloudBaseUrl);
window.installerApi.onInstallEvent(handleInstallEvent);
window.installerApi.onDevHubEvent(handleDevHubEvent);

boot();

async function boot() {
  const defaults = await window.installerApi.getDefaults();
  installPathInput.value = defaults.installPath;
  repoUrlInput.value = defaults.repoUrl;
  syncCloudBaseUrl();
  await runSystemCheck();
}

async function runSystemCheck() {
  checksElement.innerHTML = '<div class="check pending">Checking...</div>';
  checksSummaryElement.textContent = "Running";
  runCheckButton.disabled = true;

  try {
    checksState = await window.installerApi.checkSystem();
    renderChecks(checksState);
  } catch (error) {
    checksElement.innerHTML = `<div class="check fail">System check failed: ${escapeHtml(error.message)}</div>`;
    checksSummaryElement.textContent = "Error";
  } finally {
    runCheckButton.disabled = false;
  }
}

function renderChecks(checks) {
  const failedRequired = checks.filter((check) => check.required && !check.ok);
  const okCount = checks.filter((check) => check.ok).length;

  checksSummaryElement.textContent =
    failedRequired.length === 0
      ? `${okCount}/${checks.length} ready`
      : `Required fixes: ${failedRequired.length}`;

  checksElement.innerHTML = checks
    .map((check) => {
      const status = check.ok ? "ok" : "fail";
      const badge = check.ok ? "OK" : check.required ? "Missing" : "Optional";
      const details = check.problem || check.output || "Ready";

      return `
        <article class="check ${status}">
          <span class="check-badge">${badge}</span>
          <strong>${escapeHtml(check.label)}</strong>
          <span>${escapeHtml(details)}</span>
          <code>${escapeHtml(check.command)}</code>
        </article>
      `;
    })
    .join("");
}

async function selectInstallPath() {
  const selectedPath = await window.installerApi.selectInstallDir();
  if (selectedPath) installPathInput.value = selectedPath;
}

async function prepareInstall() {
  prepareButton.disabled = true;
  prepareButton.textContent = "Preparing...";

  try {
    const payload = formPayload();
    const result = await window.installerApi.prepareInstall(payload);
    renderResult(result);
  } catch (error) {
    renderError(error);
  } finally {
    prepareButton.disabled = false;
    prepareButton.textContent = "Prepare install";
  }
}

async function startInstall() {
  resetInstallLog();
  setInstallRunning(true);
  appendLog("Starting installer...");

  try {
    const response = await window.installerApi.startInstall(formPayload());
    if (!response.ok) {
      throw new Error(response.error || "Could not start installer.");
    }

    activeRunId = response.runId;
    appendLog(`Run ID: ${activeRunId}`);
  } catch (error) {
    appendLog(`Error: ${error.message}`, "error");
    setInstallRunning(false);
  }
}

async function cancelInstall() {
  if (!activeRunId) return;
  cancelInstallButton.disabled = true;
  appendLog("Stop requested...");
  await window.installerApi.cancelInstall(activeRunId);
}

async function startDevHub() {
  installPanelElement.classList.remove("hidden");
  appendLog("Starting DevAgent Hub...");
  setDevHubRunning(true);

  try {
    const response = await window.installerApi.startDevHub(formPayload());
    if (!response.ok) {
      throw new Error(response.error || "Could not start DevAgent Hub.");
    }

    activeDevHubRunId = response.runId;
    devHubLinkElement.href = response.url;
    devHubLinkElement.classList.remove("hidden");
  } catch (error) {
    appendLog(`DevAgent Hub start failed: ${error.message}`, "error");
    setDevHubRunning(false);
  }
}

async function stopDevHub() {
  if (!activeDevHubRunId) return;
  stopDevHubButton.disabled = true;
  appendLog("Stopping DevAgent Hub...");
  await window.installerApi.stopDevHub(activeDevHubRunId);
}

function formPayload() {
  return Object.fromEntries(new FormData(formElement).entries());
}

function renderResult(result) {
  resultPanelElement.classList.remove("hidden");
  resultStatusElement.textContent = result.ok ? "Ready" : "Error";

  warningsElement.innerHTML = result.warnings.length
    ? result.warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")
    : "";

  filesElement.innerHTML = `
    <strong>Files</strong>
    ${result.files.map((file) => `<code>${escapeHtml(file)}</code>`).join("")}
  `;

  commandsElement.innerHTML = result.commands
    .map((command) => `<li><code>${escapeHtml(command)}</code></li>`)
    .join("");
}

function renderError(error) {
  resultPanelElement.classList.remove("hidden");
  resultStatusElement.textContent = "Error";
  warningsElement.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  filesElement.innerHTML = "";
  commandsElement.innerHTML = "";
}

function handleInstallEvent(event) {
  if (activeRunId && event.runId !== activeRunId) return;

  switch (event.type) {
    case "prepare-start":
      installStatusElement.textContent = "Preparing";
      appendLog(event.message);
      break;
    case "prepare-complete":
      installStatusElement.textContent = "Configuration ready";
      appendLog(event.message);
      if (event.warnings?.length) {
        event.warnings.forEach((warning) => appendLog(warning, "warning"));
      }
      break;
    case "run-start":
      installStatusElement.textContent = "Running";
      updateProgress(0, event.totalSteps);
      appendLog(`Steps to run: ${event.totalSteps}`);
      break;
    case "step-start":
      installStatusElement.textContent = event.label;
      updateProgress(event.index, event.totalSteps);
      appendLog(`> ${event.command}`);
      break;
    case "stdout":
      appendLog(event.message.trimEnd());
      break;
    case "stderr":
      appendLog(event.message.trimEnd(), "warning");
      break;
    case "step-complete":
      updateProgress(event.index + 1, event.totalSteps);
      appendLog(`Done: ${event.label}`);
      break;
    case "step-warning":
      updateProgress(event.index + 1, event.totalSteps);
      appendLog(`${event.label}: ${event.message}`, "warning");
      break;
    case "run-complete":
      installStatusElement.textContent = "Installation complete";
      updateProgress(event.totalSteps, event.totalSteps);
      appendLog("Installation complete.");
      setInstallRunning(false);
      activeRunId = null;
      break;
    case "run-cancelled":
      installStatusElement.textContent = "Stopped";
      appendLog(event.message || "Installation stopped.", "warning");
      setInstallRunning(false);
      activeRunId = null;
      break;
    case "run-failed":
      installStatusElement.textContent = "Error";
      appendLog(event.message || "Installation failed.", "error");
      setInstallRunning(false);
      activeRunId = null;
      break;
    default:
      if (event.message) appendLog(event.message);
  }
}

function handleDevHubEvent(event) {
  if (activeDevHubRunId && event.runId !== activeDevHubRunId) return;

  switch (event.type) {
    case "process-start":
      installStatusElement.textContent = "DevAgent Hub running";
      appendLog(event.message);
      if (event.url) {
        devHubLinkElement.href = event.url;
        devHubLinkElement.classList.remove("hidden");
      }
      break;
    case "stdout":
      appendLog(event.message.trimEnd());
      break;
    case "stderr":
      appendLog(event.message.trimEnd(), "warning");
      break;
    case "process-error":
      installStatusElement.textContent = "DevAgent Hub error";
      appendLog(event.message, "error");
      setDevHubRunning(false);
      activeDevHubRunId = null;
      break;
    case "process-exit":
      installStatusElement.textContent = "DevAgent Hub stopped";
      appendLog(event.message);
      setDevHubRunning(false);
      activeDevHubRunId = null;
      break;
    default:
      if (event.message) appendLog(event.message);
  }
}

function resetInstallLog() {
  installPanelElement.classList.remove("hidden");
  installStatusElement.textContent = "Starting";
  installLogElement.textContent = "";
  updateProgress(0, 1);
}

function appendLog(message, level = "info") {
  if (!message) return;
  const prefix = level === "error" ? "[error] " : level === "warning" ? "[warn] " : "";
  installLogElement.textContent += `${prefix}${message}\n`;
  installLogElement.scrollTop = installLogElement.scrollHeight;
}

function updateProgress(done, total) {
  const safeTotal = Math.max(total || 1, 1);
  const percent = Math.min(100, Math.round((done / safeTotal) * 100));
  installProgressElement.style.width = `${percent}%`;
}

function setInstallRunning(isRunning) {
  startInstallButton.disabled = isRunning;
  prepareButton.disabled = isRunning;
  cancelInstallButton.disabled = !isRunning;
}

function setDevHubRunning(isRunning) {
  startDevHubButton.disabled = isRunning;
  stopDevHubButton.disabled = !isRunning;
}

function syncCloudBaseUrl() {
  const provider = cloudProviderInput.value;
  if (provider === "openrouter") {
    cloudBaseUrlInput.placeholder = "https://openrouter.ai/api/v1";
  } else if (provider === "openai") {
    cloudBaseUrlInput.placeholder = "https://api.openai.com/v1";
  } else {
    cloudBaseUrlInput.placeholder = "https://proxy.example.com/v1";
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
