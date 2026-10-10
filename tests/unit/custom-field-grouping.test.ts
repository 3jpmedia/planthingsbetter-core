import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { parseQuery, printQuery, queryContext } from "../../src/core/query";
import {
	evaluateView,
	groupTasks,
	groupingField,
	isManyValuedGrouping,
	newView,
	shownCustomFields,
	snapshotContext,
} from "../../src/core/views";
import { NONE, type CustomFieldDef, type GroupByField, type WorkspaceSnapshot } from "../../src/core/types";
import { task } from "./fixtures";

const fields: CustomFieldDef[] = [
	{
		id: "f-client",
		key: "CF-0001",
		slug: "client",
		name: "Client",
		type: "select",
		options: [
			{ id: "o-acme", name: "Acme", color: "#f00" },
			{ id: "o-glob", name: "Globex", color: "#0f0" },
			{ id: "o-init", name: "Initech", color: "#00f" },
		],
	},
	{
		id: "f-tags",
		key: "CF-0002",
		slug: "channels",
		name: "Channels",
		type: "multiSelect",
		options: [
			{ id: "o-web", name: "Web", color: "#111" },
			{ id: "o-mail", name: "Email", color: "#222" },
		],
	},
	{ id: "f-owner", key: "CF-0003", slug: "owner", name: "Owner", type: "member" },
	{ id: "f-points", key: "CF-0004", slug: "points", name: "Points", type: "number" },
];

function withFields(): WorkspaceSnapshot {
	const base = sampleSnapshot();
	const [first, second] = base.workspace.people;
	const tasks = [
		task({ path: "t1", id: "T-1", title: "One", rank: "0|hzzzzz:", fields: { "f-client": "o-acme", "f-tags": ["o-web", "o-mail"], "f-owner": [first.id] } }),
		task({ path: "t2", id: "T-2", title: "Two", rank: "0|i00000:", fields: { "f-client": "o-glob", "f-tags": ["o-mail"], "f-owner": [first.id, second.id] } }),
		task({ path: "t3", id: "T-3", title: "Three", rank: "0|i00001:", fields: {} }),
		// A choice the field no longer has counts as none.
		task({ path: "t4", id: "T-4", title: "Four", rank: "0|i00002:", fields: { "f-client": "o-gone", "f-tags": ["o-gone"] } }),
	];
	return { ...base, tasks, customFields: fields };
}

const snapshot = withFields();
const context = snapshotContext(snapshot);
const qctx = queryContext(snapshot);
const summary = (groupBy: GroupByField) =>
	groupTasks(snapshot.tasks, groupBy, context).map((group) => ({ key: group.key, label: group.label, color: group.color, ids: group.tasks.map((t) => t.id) }));

describe("grouping by a custom field", () => {
	it("groups by a select's choices: every one, in order, with its color, and the unset last", () => {
		expect(summary("field:CF-0001")).toEqual([
			{ key: "o-acme", label: "Acme", color: "#f00", ids: ["T-1"] },
			{ key: "o-glob", label: "Globex", color: "#0f0", ids: ["T-2"] },
			{ key: "o-init", label: "Initech", color: "#00f", ids: [] },
			{ key: NONE, label: "No Client", color: null, ids: ["T-3", "T-4"] },
		]);
	});

	it("puts a multi-select's task in each of its choices' groups", () => {
		expect(summary("field:CF-0002")).toEqual([
			{ key: "o-web", label: "Web", color: "#111", ids: ["T-1"] },
			{ key: "o-mail", label: "Email", color: "#222", ids: ["T-1", "T-2"] },
			{ key: NONE, label: "No Channels", color: null, ids: ["T-3", "T-4"] },
		]);
	});

	it("groups by a member field's people, like assignee", () => {
		const [first, second] = snapshot.workspace.people;
		const groups = summary("field:CF-0003");
		expect(groups.map((group) => group.key)).toEqual([...snapshot.workspace.people.map((person) => person.id), NONE]);
		expect(groups.find((group) => group.key === first.id)).toMatchObject({ label: first.name, ids: ["T-1", "T-2"] });
		expect(groups.find((group) => group.key === second.id)).toMatchObject({ label: second.name, ids: ["T-2"] });
		expect(groups[groups.length - 1]).toMatchObject({ label: "No Owner", ids: ["T-3", "T-4"] });
	});

	it("groups nothing by a field it can't group by, or one it doesn't know", () => {
		for (const groupBy of ["field:CF-0004", "field:CF-0099"] as const) {
			expect(summary(groupBy)).toEqual([{ key: "all", label: "All", color: null, ids: ["T-1", "T-2", "T-3", "T-4"] }]);
		}
	});

	it("collapses and hides empty groups like the built-in groupings", () => {
		const groups = groupTasks(snapshot.tasks, "field:CF-0001", context, { emptyColumnBehavior: "auto-hide", columns: { collapsed: ["o-acme"], hidden: [] } });
		expect(groups.find((group) => group.key === "o-init")?.hidden).toBe(true);
		expect(groups.find((group) => group.key === "o-acme")?.collapsed).toBe(true);
	});

	it("says which groupings put a task in several groups", () => {
		expect(isManyValuedGrouping("label", context)).toBe(true);
		expect(isManyValuedGrouping("status", context)).toBe(false);
		expect(isManyValuedGrouping("field:CF-0001", context)).toBe(false);
		expect(isManyValuedGrouping("field:CF-0002", context)).toBe(true);
		expect(isManyValuedGrouping("field:CF-0003", context)).toBe(true);
		expect(groupingField("field:CF-0004", context)).toBeUndefined();
		expect(groupingField("field:cf-0001", context)?.name).toBe("Client");
	});

	it("evaluates a saved view grouped by a custom field", () => {
		const view = { ...newView("board", "Board", "board"), groupBy: "field:CF-0001" as const };
		expect(evaluateView(snapshot, view, context).groups.map((group) => group.label)).toEqual(["Acme", "Globex", "Initech", "No Client"]);
	});

	it("shows the field a view groups by", () => {
		const view = { hiddenFields: [], filters: {}, sortBy: "rank" as const, groupBy: "field:CF-0001" as const };
		expect(shownCustomFields(view, [], context).map((field) => field.key)).toEqual(["CF-0001"]);
	});
});

describe("group:custom.<slug> in the query language", () => {
	it("parses to the field's key, and prints its name", () => {
		const parsed = parseQuery("group:custom.client", qctx);
		expect(parsed.ok).toBe(true);
		expect(parsed.definition.groupBy).toBe("field:CF-0001");
		expect(printQuery(parsed.definition, qctx)).toContain("group:custom.client");
		expect(parseQuery("group:custom.owner", qctx).definition.groupBy).toBe("field:CF-0003");
		expect(parseQuery("group:custom.channels", qctx).definition.groupBy).toBe("field:CF-0002");
	});

	it("prints a renamed field's new name from the same stored key", () => {
		const parsed = parseQuery("group:custom.client", qctx);
		const renamed = { ...qctx, customFields: fields.map((field) => (field.key === "CF-0001" ? { ...field, slug: "customer" } : field)) };
		expect(printQuery(parsed.definition, renamed)).toContain("group:custom.customer");
	});

	it("says when a field can't group, or isn't one", () => {
		const points = parseQuery("group:custom.points", qctx);
		expect(points.ok).toBe(false);
		expect(points.issues[0]?.message).toContain("can't group");
		expect(points.definition.groupBy).toBe("none");
		const unknown = parseQuery("group:custom.nope", qctx);
		expect(unknown.ok).toBe(false);
		expect(unknown.issues[0]?.code).toBe("unknown-field");
		// No bare names.
		expect(parseQuery("group:client", qctx).ok).toBe(false);
	});
});
