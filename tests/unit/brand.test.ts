import { describe, expect, it } from "vitest";
import { BRAND_COLORS, STATUS_COLORS } from "../../src/core";

describe("BRAND_COLORS", () => {
	it("holds the logo's colors", () => {
		expect(BRAND_COLORS).toEqual({
			violet: "#7a48db",
			lightViolet: "#b498ff",
			tile: "#251645",
			ink: "#0b0b0d",
			white: "#ffffff",
		});
	});

	it("keeps the brand and the status colors apart", () => {
		const status = new Set<string>(Object.values(STATUS_COLORS));
		for (const hex of Object.values(BRAND_COLORS)) expect(status.has(hex)).toBe(false);
	});
});
