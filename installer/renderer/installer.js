const checksElement = document.getElementById("checks");
const checksSummaryElement = document.getElementById("checks-summary");
const runCheckButton = document.getElementById("run-check");
const browsePathButton = document.getElementById("browse-path");
const prepareButton = document.getElementById("prepare-install");
const startInstallButton = document.getElementById("start-install");
const cancelInstallButton = document.getElementById("cancel-install");
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

runCheckButton.addEventListener("click", runSystemCheck);
browsePathButton.addEventListener("click", selectInstallPath);
prepareButton.addEventListener("click", prepareInstall);
startInstallButton.addEventListener("click", startInstall);
cancelInstallButton.addEventListener("click", cancelInstall);
cloudProviderInput.addEventListener("change", syncCloudBaseUrl);
window.installerApi.onInstallEvent(handleInstallEvent);

boot();

async function boot() {
  const defaults = await window.installerApi.getDefaults();
  installPathInput.value = defaults.installPath;
  repoUrlInput.value = defaults.repoUrl;
  syncCloudBaseUrl();
  await runSystemCheck();
}

async function runSystemCheck() {
  checksElement.innerHTML = '<div class="check pending">Проверка...</div>';
  checksSummaryElement.textContent = "Выполняется";
  runCheckButton.disabled = true;

  try {
    checksState = await window.installerApi.checkSystem();
    renderChecks(checksState);
  } catch (error) {
    checksElement.innerHTML = `<div class="check fail">Ошибка проверки: ${escapeHtml(error.message)}</div>`;
    checksSummaryElement.textContent = "Ошибка";
  } finally {
    runCheckButton.disabled = false;
  }
}

function renderChecks(checks) {
  const failedRequired = checks.filter((check) => check.required && !check.ok);
  const okCount = checks.filter((check) => check.ok).length;

  checksSummaryElement.textContent =
    failedRequired.length === 0
      ? `${okCount}/${checks.length} готово`
      : `Нужно исправить: ${failedRequired.length}`;

  checksElement.innerHTML = checks
    .map((check) => {
      const status = check.ok ? "ok" : "fail";
      const badge = check.ok ? "OK" : "Нет";
      const details = check.problem || check.output || "Готово";

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
  prepareButton.textContent = "Подготовка...";

  try {
    const payload = formPayload();
    const result = await window.installerApi.prepareInstall(payload);
    renderResult(result);
  } catch (error) {
    renderError(error);
  } finally {
    prepareButton.disabled = false;
    prepareButton.textContent = "Подготовить установку";
  }
}

async function startInstall() {
  resetInstallLog();
  setInstallRunning(true);
  appendLog("Подготовка запуска установки...");

  try {
    const response = await window.installerApi.startInstall(formPayload());
    if (!response.ok) {
      throw new Error(response.error || "Не удалось запустить установку");
    }

    activeRunId = response.runId;
    appendLog(`Run ID: ${activeRunId}`);
  } catch (error) {
    appendLog(`Ошибка: ${error.message}`, "error");
    setInstallRunning(false);
  }
}

async function cancelInstall() {
  if (!activeRunId) return;
  cancelInstallButton.disabled = true;
  appendLog("Запрошена остановка...");
  await window.installerApi.cancelInstall(activeRunId);
}

function formPayload() {
  return Object.fromEntries(new FormData(formElement).entries());
}

function renderResult(result) {
  resultPanelElement.classList.remove("hidden");
  resultStatusElement.textContent = result.ok ? "Готово" : "Ошибка";

  warningsElement.innerHTML = result.warnings.length
    ? result.warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")
    : "";

  filesElement.innerHTML = `
    <strong>Файлы</strong>
    ${result.files.map((file) => `<code>${escapeHtml(file)}</code>`).join("")}
  `;

  commandsElement.innerHTML = result.commands
    .map((command) => `<li><code>${escapeHtml(command)}</code></li>`)
    .join("");
}

function renderError(error) {
  resultPanelElement.classList.remove("hidden");
  resultStatusElement.textContent = "Ошибка";
  warningsElement.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  filesElement.innerHTML = "";
  commandsElement.innerHTML = "";
}

function handleInstallEvent(event) {
  if (activeRunId && event.runId !== activeRunId) return;

  switch (event.type) {
    case "prepare-start":
      installStatusElement.textContent = "Подготовка";
      appendLog(event.message);
      break;
    case "prepare-complete":
      installStatusElement.textContent = "Конфигурация готова";
      appendLog(event.message);
      if (event.warnings?.length) {
        event.warnings.forEach((warning) => appendLog(warning, "warning"));
      }
      break;
    case "run-start":
      installStatusElement.textContent = "Выполняется";
      updateProgress(0, event.totalSteps);
      appendLog(`Команд к выполнению: ${event.totalSteps}`);
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
      appendLog(`Готово: ${event.label}`);
      break;
    case "run-complete":
      installStatusElement.textContent = "Установка завершена";
      updateProgress(event.totalSteps, event.totalSteps);
      appendLog("Установка завершена");
      setInstallRunning(false);
      activeRunId = null;
      break;
    case "run-cancelled":
      installStatusElement.textContent = "Остановлено";
      appendLog(event.message || "Установка остановлена", "warning");
      setInstallRunning(false);
      activeRunId = null;
      break;
    case "run-failed":
      installStatusElement.textContent = "Ошибка";
      appendLog(event.message || "Установка завершилась с ошибкой", "error");
      setInstallRunning(false);
      activeRunId = null;
      break;
    default:
      if (event.message) appendLog(event.message);
  }
}

function resetInstallLog() {
  installPanelElement.classList.remove("hidden");
  installStatusElement.textContent = "Запуск";
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
