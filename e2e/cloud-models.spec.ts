import { test, expect } from "@playwright/test";
import { getAgentsConfig, loadApiModelCases, saveAgentsConfig, type ApiModelCase } from "./helpers";

const apiModels = loadApiModelCases();

test.describe("cloud API models", () => {
  if (apiModels.length === 0) {
    test("live API model cases are configured", async () => {
      test.skip(true, "Create e2e/api-models.local.json from e2e/api-models.example.json to run live API model checks.");
    });
  }

  for (const model of apiModels) {
    test(`tests and adds ${model.name}`, async ({ page, request }) => {
      const originalConfig = await getAgentsConfig(request);
      try {
        await page.goto("/#settings");
        await expect(page).toHaveTitle(/Orqen Studio/);

        await fillCloudModelForm(page, model);
        await page.getByRole("button", { name: /Проверить API|Test API/ }).click();
        await expect(page.locator(".success-strip")).toContainText(/Cloud model test succeeded|токен|tokens|provider/i, { timeout: 90_000 });

        const addButton = page.getByRole("button", { name: /Добавить облачную модель|Add cloud model/ });
        await expect(addButton).toBeEnabled();
        await addButton.click();
        await expect(page.getByText(model.name, { exact: false })).toBeVisible({ timeout: 15_000 });
      } finally {
        await saveAgentsConfig(request, originalConfig);
      }
    });
  }
});

async function fillCloudModelForm(page: import("@playwright/test").Page, model: ApiModelCase): Promise<void> {
  await page.getByLabel(/Провайдер|Provider/).selectOption(model.provider || "custom");
  await page.getByLabel(/Модель|Model/).fill(model.name);
  await page.getByLabel(/API URL|API URL/).fill(model.baseUrl);
  await page.getByLabel(/Формат API|API format/).selectOption(model.apiFormat || "auto");
  await page.getByLabel(/API-ключ|API key/).fill(model.apiKey);
}
