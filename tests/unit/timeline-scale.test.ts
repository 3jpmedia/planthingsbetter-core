import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { parseQuery, printQuery, queryContext } from "../../src/core/query";
import {
	TIMELINE_ZOOM_SCALES,
	buildTimeScale,
	dayNumber,
	timelineContentDomain,
	timelineDomain,
	timelineScale,
	type Bar,
} from "../../src/core/views";

const ctx = queryContext(sampleSnapshot());

describe("zoom: clause", () => {
	it("parses every level and alias; unknown is an error", () => {
		expect(parseQuery("layout:timeline zoom:month", ctx).definition.timelineZoom).toBe("month");
		expect(parseQuery("layout:timeline zoom:fit", ctx).definition.timelineZoom).toBe("all");
		expect(parseQuery("layout:timeline", ctx).definition.timelineZoom).toBe("week");
		const bad = parseQuery("layout:timeline zoom:decade", ctx);
		expect(bad.issues.some((i) => i.severity === "error")).toBe(true);
	});

	it("prints only on a timeline, and only when not the default", () => {
		const def = (q: string) => parseQuery(q, ctx).definition;
		expect(printQuery(def("layout:timeline zoom:quarter"), ctx)).toContain("zoom:quarter");
		expect(printQuery(def("layout:timeline zoom:week"), ctx)).not.toContain("zoom:");
		expect(printQuery(def("layout:list zoom:quarter"), ctx)).not.toContain("zoom:");
	});

	it("round-trips", () => {
		for (const zoom of ["day", "month", "quarter", "year", "all"]) {
			const printed = printQuery(parseQuery(`layout:timeline zoom:${zoom}`, ctx).definition, ctx);
			expect(parseQuery(printed, ctx).definition.timelineZoom).toBe(zoom);
		}
	});
});

describe("timeline scale", () => {
	const today = "2026-09-29";
	const bars: Bar[] = [
		{ kind: "range", start: "2026-09-10", end: "2026-09-20" },
		{ kind: "milestone", date: "2026-10-05" },
	] as Bar[];

	it("pads the bars' range by 7 days and always reaches today", () => {
		const d = timelineContentDomain(bars, today);
		expect(d.minDay).toBe(dayNumber("2026-09-03"));
		expect(d.maxDay).toBe(dayNumber("2026-10-12"));
		const empty = timelineContentDomain([], today);
		expect(empty.minDay).toBe(dayNumber(today) - 30);
	});

	it("uses fixed scales, and all fits the content to the width", () => {
		const d = timelineContentDomain(bars, today);
		expect(timelineScale("month", d, 800)).toBe(TIMELINE_ZOOM_SCALES.month);
		expect(timelineScale("all", d, 800)).toBeCloseTo(800 / d.days);
	});

	it("widens the drawn span evenly to fill the width", () => {
		const d = timelineContentDomain(bars, today);
		const wide = timelineDomain(d, 2000, 18);
		expect(wide.days).toBe(Math.ceil(2000 / 18));
		expect(d.minDay - wide.minDay).toBeLessThanOrEqual(wide.maxDay - d.maxDay);
		expect(timelineDomain(d, 100, 18)).toEqual(d);
	});

	it("builds day columns under month bands, and month columns when zoomed out", () => {
		const min = dayNumber("2026-09-28");
		const zoomedIn = buildTimeScale(min, 7, 40);
		expect(zoomedIn.ticks.map((t) => t.label)).toEqual(["28", "29", "30", "1", "2", "3", "4"]);
		expect(zoomedIn.ticks[3].major).toBe(true);
		expect(zoomedIn.bands.map((b) => b.label)).toEqual(["September 2026", "October 2026"]);
		const zoomedOut = buildTimeScale(dayNumber("2026-11-01"), 92, 1);
		expect(zoomedOut.ticks.map((t) => t.label[0])).toEqual(["N", "D", "J"]);
		expect(zoomedOut.ticks[2].major).toBe(true);
		expect(zoomedOut.bands.map((b) => b.label)).toEqual(["2026", "2027"]);
	});
});
