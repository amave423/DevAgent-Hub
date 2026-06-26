const checksElement = document.getElementById("checks");
const runCheckButton = document.getElementById("run-check");

runCheckButton.addEventListener("click", async () => {
  checksElement.innerHTML = '<div class="check pending">Проверка...</div>';
  const checks = await window.installerApi.checkSystem();
  checksElement.innerHTML = checks
    .map(
      (check) => `
        <article class="check ${check.ok ? "ok" : "fail"}">
          <strong>${check.label}</strong>
          <span>${check.output || "Не найдено"}</span>
        </article>
      `,
    )
    .join("");
});

runCheckButton.click();

