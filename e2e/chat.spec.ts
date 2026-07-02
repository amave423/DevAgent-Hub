import { test, expect } from "@playwright/test";
import { cleanupNewChats, existingChatIds, expectNoFrameworkOverlay, getAgentsConfig, saveAgentsConfig, useMockRuntime } from "./helpers";

test.describe("chat", () => {
  test("sends a prompt, runs the agent chain, and renders an assistant reply", async ({ page, request }) => {
    const originalConfig = await useMockRuntime(request);
    const beforeChatIds = await existingChatIds(request);

    try {
      await page.goto("/#chat");
      await expect(page).toHaveTitle(/Orqen Studio/);
      await expectNoFrameworkOverlay(page);

      await page.getByRole("button", { name: /^(Новый чат|New chat)$/ }).click();
      const composer = page.getByPlaceholder(/Напиши задачу|Write/i);
      await composer.fill("E2E chat smoke: answer in one short sentence.");

      await expect(page.getByRole("button", { name: /Запустить|Run/ })).toBeEnabled();
      await page.getByRole("button", { name: /Запустить|Run/ }).click();

      await expect(page.locator(".chat-bubble.user").last()).toContainText("E2E chat smoke");
      await expect(page.locator(".chat-bubble.assistant, .chat-bubble.agent").last()).toContainText(/\[mock:/, { timeout: 30_000 });
      await expect(page.getByRole("button", { name: /Обычный|Normal/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /Полный доступ|Full access/ })).toHaveCount(0);
    } finally {
      await cleanupNewChats(request, beforeChatIds);
      await saveAgentsConfig(request, originalConfig);
    }
  });
});
