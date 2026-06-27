const checksElement = document.getElementById("checks");
const checksSummaryElement = document.getElementById("checks-summary");
const runCheckButton = document.getElementById("run-check");
const browsePathButton = document.getElementById("browse-path");
const prepareButton = document.getElementById("prepare-install");
const formElement = document.getElementById("settings-form");
const resultPanelElement = document.getElementById("result-panel");
const resultStatusElement = document.getElementById("result-status");
const warningsElement = document.getElementById("warnings");
const filesElement = document.getElementById("files");
const commandsElement = document.getElementById("commands");

const installPathInput = document.getElementById("install-path");
const repoUrlInput = document.getElementById("repo-url");
const cloudProviderInput = document.getElementById("cloud-provider");
const cloudBaseUrlInput = document.getElementById("cloud-base-url");

let checksState = [];

runCheckButton.addEventListener("click", runSystemCheck);
browsePathButton.addEventListener("click", selectInstallPath);
prepareButton.addEventListener("click", prepareInstall);
cloudProviderInput.addEventListener("change", syncCloudBaseUrl);

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
