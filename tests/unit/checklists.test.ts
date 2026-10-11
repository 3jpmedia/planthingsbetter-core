import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { parseQuery, printQuery, queryContext } from "../../src/core/query";
import { canonicalizeDefinition, matchesFilters, snapshotContext } from "../../src/core/views";
import { DEFAULT_DEFINITION } from "../../src/core/views/defaults";
import {
	checklistNameKey,
	checklistTotals,
	hasOpenChecklistNamed,
	summarizeChecklists,
} from "../../src/core/checklists";
import {
	CHECKLISTS_END_TAG,
	CHECKLISTS_START_TAG,
	parseChecklists,
	replaceChecklists,
	serializeChecklists,
} from "../../src/core/serialization/checklists";
import { COMMENTS_END, COMMENTS_START, parseComments, withComments } from "../../src/core/serialization/comments";
import { DESCRIPTION_END_TAG, DESCRIPTION_START_TAG, parseDescription } from "../../src/core/serialization/description";
import { buildExport } from "../../src/core/export";
import { taskRow } from "../../src/core/mcp/responses";
import type { Checklist, ViewDefinition } from "../../src/core/types";
import { task } from "./fixtures";

const LISTS: Checklist[] = [
	{ name: "Done when", items: [{ text: "Send test email", done: true }, { text: "Check the logs", done: false }] },
	{ name: "After deploy", items: [{ text: "Run the backfill", done: false }] },
	{ name: "Empty", items: [] },
];

describe("counting", () => {
	it("counts each list and all of them together", () => {
		const summary = summarizeChecklists(LISTS);
		expect(summary).toEqual([
			{ name: "Done when", done: 1, total: 2 },
			{ name: "After deploy", done: 0, total: 1 },
			{ name: "Empty", done: 0, total: 0 },
		]);
		expect(checklistTotals(summary)).toEqual({ done: 1, total: 3 });
		expect(checklistTotals([])).toBeNull();
		expect(checklistTotals([{ name: "Empty", done: 0, total: 0 }])).toBeNull();
	});

	it("compares names loosely", () => {
		expect(checklistNameKey("  After   Deploy ")).toBe("after deploy");
		const summary = summarizeChecklists(LISTS);
		expect(hasOpenChecklistNamed({ checklists: summary }, ["after deploy"])).toBe(true);
		expect(hasOpenChecklistNamed({ checklists: summary }, ["Empty"])).toBe(false);
		expect(hasOpenChecklistNamed({ checklists: summary }, ["Nope"])).toBe(false);
	});
});

describe("markdown", () => {
	const DESCRIPTION = `${DESCRIPTION_START_TAG}\n## Description\nShip it.\n- [ ] not a checklist item\n${DESCRIPTION_END_TAG}`;
	const COMMENTS = `${COMMENTS_START}\n## Comments\n<comment id="c1" author="jr" date="2026-10-01T00:00:00Z">\nHi\n</comment>\n${COMMENTS_END}`;

	it("writes a fenced ## Checklists section with a ### per list", () => {
		expect(serializeChecklists(LISTS)).toBe(
			[
				CHECKLISTS_START_TAG,
				"## Checklists",
				"### Done when",
				"- [x] Send test email",
				"- [ ] Check the logs",
				"### After deploy",
				"- [ ] Run the backfill",
				"### Empty",
				CHECKLISTS_END_TAG,
			].join("\n"),
		);
		expect(serializeChecklists([])).toBe("");
	});

	it("round-trips through a note body, between the description and the comments", () => {
		const body = `${DESCRIPTION}\n\n${COMMENTS}\n`;
		const written = replaceChecklists(body, LISTS);
		expect(written.indexOf(CHECKLISTS_START_TAG)).toBeGreaterThan(written.indexOf(DESCRIPTION_END_TAG));
		expect(written.indexOf(CHECKLISTS_START_TAG)).toBeLessThan(written.indexOf(COMMENTS_START));
		expect(parseChecklists(written)).toEqual(LISTS);
		// The rest of the note reads as it did.
		expect(parseDescription(written)).toBe(parseDescription(body));
		expect(parseComments(written)).toEqual(parseComments(body));
		// Ticking one rewrites only the section.
		const ticked = replaceChecklists(written, [{ ...LISTS[0], items: LISTS[0].items.map((item) => ({ ...item, done: true })) }, ...LISTS.slice(1)]);
		expect(parseChecklists(ticked)[0].items.every((item) => item.done)).toBe(true);
		expect(ticked.replace(/- \[[ x]\]/g, "")).toBe(written.replace(/- \[[ x]\]/g, ""));
		// No lists: the section goes, and the note is as it was.
		expect(replaceChecklists(written, [])).toBe(body);
	});

	it("survives the comments block being rewritten", () => {
		const written = replaceChecklists(`${DESCRIPTION}\n\n${COMMENTS}\n`, LISTS);
		expect(parseChecklists(withComments(written, []))).toEqual(LISTS);
	});

	it("adds the section to a note with neither block", () => {
		expect(parseChecklists(replaceChecklists("Some notes.\n", LISTS))).toEqual(LISTS);
		expect(parseChecklists(replaceChecklists("", LISTS))).toEqual(LISTS);
	});

	it("reads a hand-written section, without the fence", () => {
		const body = [
			"Intro.",
			"",
			"## Checklists",
			"* [X] Loose item",
			"### Launch",
			"+ [ ] First",
			"- [x]   Second  ",
			"- not an item",
			"",
			"## Notes",
			"- [ ] Not in a checklist",
		].join("\n");
		expect(parseChecklists(body)).toEqual([
			{ name: "Checklist", items: [{ text: "Loose item", done: true }] },
			{ name: "Launch", items: [{ text: "First", done: false }, { text: "Second", done: true }] },
		]);
		// Rewritten in place, fenced, leaving the rest alone.
		const rewritten = replaceChecklists(body, [{ name: "Launch", items: [{ text: "First", done: true }] }]);
		expect(rewritten.startsWith("Intro.\n\n" + CHECKLISTS_START_TAG)).toBe(true);
		expect(rewritten).toContain("## Notes\n- [ ] Not in a checklist");
		expect(parseChecklists(rewritten)).toEqual([{ name: "Launch", items: [{ text: "First", done: true }] }]);
	});

	it("ignores checkboxes in the description", () => {
		expect(parseChecklists(`${DESCRIPTION}\n`)).toEqual([]);
	});

	it("keeps names and items to one line", () => {
		const written = serializeChecklists([{ name: "Two\nlines", items: [{ text: "a\nb", done: false }] }]);
		expect(parseChecklists(written)).toEqual([{ name: "Two lines", items: [{ text: "a b", done: false }] }]);
	});
});

describe("query clauses", () => {
	const snapshot = sampleSnapshot();
	const ctx = queryContext(snapshot);
	const viewCtx = snapshotContext(snapshot);
	const def = (partial: Partial<ViewDefinition> = {}): ViewDefinition => ({ ...DEFAULT_DEFINITION, ...partial });

	const none = task({ id: "TSK-1" });
	const emptyList = task({ id: "TSK-2", checklists: [{ name: "Later", done: 0, total: 0 }] });
	const allDone = task({ id: "TSK-3", checklists: [{ name: "Done when", done: 2, total: 2 }] });
	const open = task({ id: "TSK-4", checklists: [{ name: "Done when", done: 1, total: 2 }, { name: "After deploy", done: 0, total: 1 }] });
	const tasks = [none, emptyList, allDone, open];
	const ids = (query: string) => {
		const parsed = parseQuery(query, ctx);
		expect(parsed.issues.filter((issue) => issue.severity === "error")).toEqual([]);
		return tasks.filter((t) => matchesFilters(t, parsed.definition.filters, viewCtx)).map((t) => t.id);
	};

	it("has:checklist, is:checklist-open and checklist:<name>", () => {
		expect(ids("has:checklist")).toEqual(["TSK-2", "TSK-3", "TSK-4"]);
		expect(ids("has:checklists")).toEqual(["TSK-2", "TSK-3", "TSK-4"]);
		expect(ids("is:checklist-open")).toEqual(["TSK-4"]);
		expect(ids('checklist:"after deploy"')).toEqual(["TSK-4"]);
		expect(ids('checklist:"Done when"')).toEqual(["TSK-4"]);
		expect(ids('checklist:Later,"After deploy"')).toEqual(["TSK-4"]);
		expect(ids("checklist:Later")).toEqual([]);
	});

	it("round-trips through the printer", () => {
		for (const filters of [{ hasChecklist: true }, { checklistOpen: true }, { checklist: ["After deploy", "Done when"] }, { checklist: ['Say "hi"', "=odd"] }]) {
			const definition = def({ filters });
			const source = printQuery(definition, ctx);
			const parsed = parseQuery(source, ctx);
			expect(parsed.ok).toBe(true);
			expect(parsed.definition).toEqual(canonicalizeDefinition(definition));
		}
		expect(printQuery(def({ filters: { hasChecklist: true, checklistOpen: true, checklist: ["After deploy"] } }), ctx)).toContain(
			'has:checklist is:checklist-open checklist:"After deploy"',
		);
	});

	it("dedupes names and rejects what it can't express", () => {
		expect(parseQuery('checklist:"Done when","done  WHEN"', ctx).definition.filters.checklist).toEqual(["Done when"]);
		expect(parseQuery("has:labels", ctx).ok).toBe(false);
		expect(parseQuery("-checklist:Done", ctx).ok).toBe(false);
		expect(parseQuery("checklist:", ctx).ok).toBe(false);
	});
});

describe("elsewhere", () => {
	it("exports checklists to CSV and JSON when asked", () => {
		const snapshot = sampleSnapshot();
		const first = snapshot.tasks[0];
		const common = {
			snapshot,
			scope: { kind: "workspace" as const },
			today: "2026-10-11",
			includeArchived: true,
			pluginVersion: "test",
			checklists: { [first.id]: LISTS.slice(0, 1) },
		};
		const csv = buildExport({ ...common, format: "csv", fields: ["id", "checklists"] }).content;
		expect(csv).toContain("Checklists");
		expect(csv).toContain("Done when: [x] Send test email; [ ] Check the logs");
		const json = JSON.parse(buildExport({ ...common, format: "json", fields: ["id", "checklists"] }).content) as { checklists?: Record<string, Checklist[]> };
		expect(json.checklists?.[first.id]).toEqual(LISTS.slice(0, 1));
		const without = JSON.parse(buildExport({ ...common, format: "json", fields: ["id"] }).content) as { checklists?: unknown };
		expect(without.checklists).toBeUndefined();
	});

	it("puts progress on a connector task row only when there is some", () => {
		expect(taskRow(new Map(), task({})).checklistProgress).toBeUndefined();
		expect(taskRow(new Map(), task({ checklists: [{ name: "A", done: 1, total: 3 }] })).checklistProgress).toEqual({ done: 1, total: 3 });
	});
});
