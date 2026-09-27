import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import {
	parseQuery,
	printFilters,
	printQuery,
	queryContext,
	type QueryContext,
} from "../../src/core/query";
import { canonicalizeFilters, viewDefinition } from "../../src/core/views";
import { defaultViews } from "../../src/core/views/defaults";
import { NONE, type ViewFilters } from "../../src/core/types";

const snapshot = sampleSnapshot();
const ctx = queryContext(snapshot);

describe("printFilters", () => {
	const cases: [string, ViewFilters][] = [
		["empty", {}],
		["status + type", { status: ["todo", "in-progress"], taskType: ["bug"] }],
		["labels", { labels: ["backend", "performance"] }],
		["text", { text: "auth" }],
		["archived + flags", { archived: "only", openOnly: true, recurring: true }],
		["unset", { labels: ["unset"] }],
		["due date exact", { dueDate: ["2026-09-19", "2026-09-20"] }],
		["due date unset", { dueDate: ["unset"] }],
		[
			"every date field, exact + bound",
			{
				dueDate: ["2026-09-19"],
				startDate: ["2026-09-01"],
				createdAt: ["2026-08-01"],
				updatedAt: ["2026-08-15"],
				completedAt: ["2026-09-10"],
				dueDateBefore: "2026-10-01",
				dueDateAfter: "2026-09-01",
				startDateBefore: "2026-09-15",
				startDateAfter: "2026-08-15",
				createdAtBefore: "2026-08-20",
				createdAtAfter: "2026-07-20",
				updatedAtBefore: "2026-09-01",
				updatedAtAfter: "2026-08-01",
				completedAtBefore: "2026-09-20",
				completedAtAfter: "2026-09-01",
			},
		],
		[
			"include and exclude on the same field",
			{
				status: ["todo", "in-progress"],
				excludeStatus: ["blocked"],
				priority: ["high"],
				excludePriority: [NONE],
			},
		],
	];

	for (const [name, filters] of cases) {
		it(`round-trips ${name} through parseQuery`, () => {
			const printed = printFilters(filters, ctx);
			const parsed = parseQuery(printed, ctx);
			expect(parsed.issues.filter((i) => i.severity === "error")).toEqual([]);
			expect(parsed.definition.filters).toEqual(canonicalizeFilters(filters));
		});
	}

	it("emits no layout tokens", () => {
		const printed = printFilters({ status: ["todo"] }, ctx);
		expect(printed).not.toMatch(/\b(group|sort|hide|layout|empty|subtasks|date):/);
	});
});

describe("printQuery is unchanged for the query bar", () => {
	it("still prints group and sort for a default view", () => {
		expect(printQuery(viewDefinition(defaultViews()[0]), ctx)).toContain("group:");
		expect(printQuery(viewDefinition(defaultViews()[0]), ctx)).toContain("sort:");
	});

	it("prepends the filter clause to the layout clauses", () => {
		const printed = printQuery(
			{ ...viewDefinition(defaultViews()[0]), filters: { taskType: ["bug"] } },
			ctx,
		);
		// The taxonomy value's name ("Bug") prints in place of its id ("bug") --
		// see print.ts's candidatesFor, which now prefers a resolving name over
		// the raw id, same as the entity (project/task) branch already did.
		expect(printed.startsWith("type:Bug ")).toBe(true);
	});
});

// Callers that store a task's relation identity as an opaque document id --
// Plan Things Better uses a Mongo ObjectId -- rather than the human task key.
// `basename()` of an ObjectId is the ObjectId, so an entity branch that tried
// the basename first round-tripped the raw id and printed it instead of the
// key that was sitting in `QueryEntity.title`.
describe("printFilters prefers the task key over an opaque stored id", () => {
	const key = ctx.tasks[0].title;
	// Same task, re-keyed the way PTB stores it.
	const stored = `6a1b2c3d4e5f6a7b8c9d0e1`;
	const opaqueCtx: QueryContext = {
		...ctx,
		tasks: [{ path: stored, title: key }],
	};

	it("prints the key for parent, root and id", () => {
		const printed = printFilters({ parent: [stored], root: [stored], id: [stored] }, opaqueCtx);
		expect(printed).toBe(`taskParentKey:${key} taskRootKey:${key} taskKey:${key}`);
		expect(printed).not.toContain(stored);
	});

	it("still round-trips back to the stored id", () => {
		const parsed = parseQuery(printFilters({ id: [stored] }, opaqueCtx), opaqueCtx);
		expect(parsed.issues.filter((i) => i.severity === "error")).toEqual([]);
		expect(parsed.definition.filters).toEqual({ id: [stored] });
	});

	// Unchanged for this plugin's own vault, where `Task.id` *is* the filename
	// stem: title and basename coincide, so only one candidate is emitted.
	it("is unchanged when the key already is the basename", () => {
		expect(printFilters({ parent: [ctx.tasks[0].path] }, ctx)).toBe(`taskParentKey:${key}`);
	});

	it("falls back to the raw value when the key doesn't round-trip", () => {
		// Two entities sharing a title: `resolveEntity`'s soleMatch rejects an
		// ambiguous key, so printValue must fall through to the stored value.
		const ambiguous: QueryContext = {
			...ctx,
			tasks: [
				{ path: "oid-one", title: "DUP-0001" },
				{ path: "oid-two", title: "DUP-0001" },
			],
		};
		expect(printFilters({ parent: ["oid-one"] }, ambiguous)).toBe("taskParentKey:oid-one");
	});
});

// A person's `name` can change, or a second person can join sharing an old
// one's -- either would silently break or misdirect a saved/copy-pasted
// `assignee:`/`mentions:` query printed with the name baked in. `email` is
// stable and unique per workspace member, so print prefers it.
describe("printFilters prefers a person's email over their name", () => {
	const withEmail: QueryContext = {
		...ctx,
		people: [{ id: "u1", name: "Jane Doe", email: "jane@example.com" }],
	};

	it("prints the email, not the name", () => {
		expect(printFilters({ assignee: ["u1"] }, withEmail)).toBe("assignee:jane@example.com");
	});

	it("still round-trips back to the person's id", () => {
		const parsed = parseQuery(printFilters({ assignee: ["u1"] }, withEmail), withEmail);
		expect(parsed.issues.filter((i) => i.severity === "error")).toEqual([]);
		expect(parsed.definition.filters.assignee).toEqual(["u1"]);
	});

	it("falls back to the name for a roster with no email at all", () => {
		expect(printFilters({ assignee: ["alice"] }, ctx)).toBe("assignee:Alice");
	});
});
