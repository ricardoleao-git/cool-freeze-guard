import { test, expect, Route } from "@playwright/test";

// Mock kiosk-panel responses so tests are deterministic.
const FN_PATTERN = /\/functions\/v1\/kiosk-panel(\?.*)?$/;

const NOW_ISO = new Date("2026-06-27T12:00:00Z").toISOString();

// area thresholds: yellow 30, orange 60, red 90
const VALID_PAYLOAD = {
  tenant_nome: "ACME Cold",
  server_time: NOW_ISO,
  areas: [
    {
      id: "area-1",
      name: "Câmara 1",
      exposure_limit_minutes: 90,
      warning_yellow_minutes: 30,
      warning_orange_minutes: 60,
    },
  ],
  inside: [
    // ok ~ 5 min
    {
      primeiro_nome: "Ana",
      avatar: null,
      area_id: "area-1",
      area_nome: "Câmara 1",
      inside_since: new Date(Date.parse(NOW_ISO) - 5 * 60_000).toISOString(),
    },
    // yellow ~ 40 min
    {
      primeiro_nome: "Bruno",
      avatar: null,
      area_id: "area-1",
      area_nome: "Câmara 1",
      inside_since: new Date(Date.parse(NOW_ISO) - 40 * 60_000).toISOString(),
    },
    // orange ~ 70 min
    {
      primeiro_nome: "Carla",
      avatar: null,
      area_id: "area-1",
      area_nome: "Câmara 1",
      inside_since: new Date(Date.parse(NOW_ISO) - 70 * 60_000).toISOString(),
    },
    // red ~ 100 min (highest priority -> first)
    {
      primeiro_nome: "Diego",
      avatar: null,
      area_id: "area-1",
      area_nome: "Câmara 1",
      inside_since: new Date(Date.parse(NOW_ISO) - 100 * 60_000).toISOString(),
    },
  ],
  summary: { total: 4, ok: 1, yellow: 1, orange: 1, red: 1 },
  daily_pride: { thermal_breaks_today: 3, external_readings_today: 2 },
};

async function mockValid(route: Route) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(VALID_PAYLOAD),
  });
}

async function mockRevoked(route: Route) {
  await route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ error: "invalid_token" }),
  });
}

test.describe("/painel kiosk público", () => {
  test("token válido: renderiza semáforo e ordena por risco", async ({ page }) => {
    await page.route(FN_PATTERN, mockValid);

    await page.goto("/painel?token=valid-token-1234567890");

    const panel = page.getByTestId("kiosk-panel");
    await expect(panel).toBeVisible();

    // Semáforo: contagens corretas
    await expect(page.getByTestId("tile-ok")).toContainText("1");
    await expect(page.getByTestId("tile-yellow")).toContainText("1");
    await expect(page.getByTestId("tile-orange")).toContainText("1");
    await expect(page.getByTestId("tile-red")).toContainText("1");

    // Ordenação determinística: red, orange, yellow, ok
    const cards = page.getByTestId("kiosk-person");
    await expect(cards).toHaveCount(4);
    await expect(cards.nth(0)).toHaveAttribute("data-risk", "red");
    await expect(cards.nth(0)).toHaveAttribute("data-name", "Diego");
    await expect(cards.nth(1)).toHaveAttribute("data-risk", "orange");
    await expect(cards.nth(1)).toHaveAttribute("data-name", "Carla");
    await expect(cards.nth(2)).toHaveAttribute("data-risk", "yellow");
    await expect(cards.nth(2)).toHaveAttribute("data-name", "Bruno");
    await expect(cards.nth(3)).toHaveAttribute("data-risk", "ok");
    await expect(cards.nth(3)).toHaveAttribute("data-name", "Ana");
  });

  test("token revogado: exibe tela de erro clara", async ({ page }) => {
    await page.route(FN_PATTERN, mockRevoked);

    await page.goto("/painel?token=revoked-token-1234567890");

    const invalid = page.getByTestId("kiosk-invalid");
    await expect(invalid).toBeVisible();
    await expect(invalid).toContainText(/Token inválido ou revogado/i);
    await expect(page.getByTestId("kiosk-panel")).toHaveCount(0);
  });
});
