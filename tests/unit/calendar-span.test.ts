import { describe, expect, it } from "vitest";
import { parseQuery, printQuery } from "../../src/core/query";
import {
	calendarAnchorDate,
	calendarDays,
	calendarSpan,
	layoutWeek,
	shiftCalendar,
	startOfWeek,
	unscheduledForCalendar,
} from "../../src/core/views/calendar";
import { task } from "./fixtures";

describe("calendarSpan", () => {
	it("one date: the day it names", () => {
		expect(calendarSpan(task({ dueDate: "2026-09-10" }), "dueDate")).toEqual({ start: "2026-09-10", end: "2026-09-10", partial: false });
		expect(calendarSpan(task({ dueDate: null }), "dueDate")).toBeNull();
	});

	it("two dates: from the earlier to the later, whichever field holds which", () => {
		const t = task({ startDate: "2026-09-08", dueDate: "2026-09-12" });
		expect(calendarSpan(t, "startDate", "dueDate")).toEqual({ start: "2026-09-08", end: "2026-09-12", partial: false });
		expect(calendarSpan(t, "dueDate", "startDate")).toEqual({ start: "2026-09-08", end: "2026-09-12", partial: false });
	});

	it("two dates, only one set: that day, partial; neither: unscheduled", () => {
		expect(calendarSpan(task({ startDate: null, dueDate: "2026-09-12" }), "startDate", "dueDate")).toEqual({
			start: "2026-09-12",
			end: "2026-09-12",
			partial: true,
		});
		const none = task({ startDate: null, dueDate: null });
		expect(calendarSpan(none, "startDate", "dueDate")).toBeNull();
		expect(unscheduledForCalendar([none], "startDate", "dueDate")).toEqual([none]);
	});

	it("reads created / updated / completed timestamps as days", () => {
		const t = task({ createdAt: "2026-09-01T10:00:00.000Z", completedAt: "2026-09-04T18:00:00.000Z" });
		expect(calendarSpan(t, "createdAt", "completedAt")).toEqual({ start: "2026-09-01", end: "2026-09-04", partial: false });
	});
});

describe("layoutWeek", () => {
	const span = (start: string, end: string) => ({ start, end, partial: false })

	it("stacks overlapping spans in lanes, longer first, and reuses free lanes", () => {
		const placed = layoutWeek(
			[
				{ item: "short", span: span("2026-09-07", "2026-09-07") },
				{ item: "long", span: span("2026-09-07", "2026-09-10") },
				{ item: "later", span: span("2026-09-11", "2026-09-12") },
			],
			"2026-09-06",
		);
		const by = Object.fromEntries(placed.map((p) => [p.item, p]));
		expect(by.long).toMatchObject({ col: 1, length: 4, lane: 0 });
		expect(by.short).toMatchObject({ col: 1, length: 1, lane: 1 });
		expect(by.later).toMatchObject({ col: 5, length: 2, lane: 0 });
	});

	it("clips spans at the week's edges and says they carry on", () => {
		const [p] = layoutWeek([{ item: "x", span: span("2026-09-03", "2026-09-15") }], "2026-09-06");
		expect(p).toMatchObject({ col: 0, length: 7, continuesBefore: true, continuesAfter: true });
		expect(layoutWeek([{ item: "y", span: span("2026-08-01", "2026-08-02") }], "2026-09-06")).toEqual([]);
	});
});

describe("calendar layouts", () => {
	it("anchors each layout: month start, week start (Sunday), or the day", () => {
		expect(startOfWeek("2026-09-10")).toBe("2026-09-06");
		expect(calendarAnchorDate("month", "2026-09-10")).toBe("2026-09-01");
		expect(calendarAnchorDate("2weeks", "2026-09-10")).toBe("2026-09-06");
		expect(calendarAnchorDate("schedule", "2026-09-10T08:00:00Z")).toBe("2026-09-10");
	});

	it("pages by a month or by as many weeks as it shows", () => {
		expect(shiftCalendar("month", "2026-09-01", 1)).toBe("2026-10-01");
		expect(shiftCalendar("week", "2026-09-10", -1)).toBe("2026-08-30");
		expect(shiftCalendar("4weeks", "2026-09-06", 1)).toBe("2026-10-04");
	});

	it("shows whole weeks: 7, 14 or 28 days from Sunday", () => {
		expect(calendarDays("week", "2026-09-10")).toHaveLength(7);
		expect(calendarDays("2weeks", "2026-09-10")[0]).toBe("2026-09-06");
		expect(calendarDays("4weeks", "2026-09-10")).toHaveLength(28);
	});
});

describe("date: and calendar: clauses", () => {
	it("reads and prints one date or two, and the layout", () => {
		const { definition, ok } = parseQuery("layout:calendar date:start,due calendar:2weeks");
		expect(ok).toBe(true);
		expect(definition.calendarDateField).toBe("startDate");
		expect(definition.calendarEndField).toBe("dueDate");
		expect(definition.calendarMode).toBe("2weeks");
		expect(printQuery(definition)).toContain("date:start,due");
		expect(printQuery(definition)).toContain("calendar:2weeks");
	});

	it("accepts the new dates, drops a repeated one, and rejects a third", () => {
		expect(parseQuery("date:created,completed").definition.calendarEndField).toBe("completedAt");
		const same = parseQuery("date:due,due").definition;
		expect(same.calendarEndField).toBeNull();
		expect(printQuery(same)).not.toContain("date:");
		expect(parseQuery("date:start,due,created").ok).toBe(false);
		expect(parseQuery("calendar:year").ok).toBe(false);
	});
});
