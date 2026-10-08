import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { parseQuery, printQuery, queryContext } from "../../src/core/query";
import { applyFilters, canonicalizeDefinition, shownCustomFields, snapshotContext, sortTasks } from "../../src/core/views";
import { DEFAULT_DEFINITION } from "../../src/core/views/defaults";
import { buildExport } from "../../src/core/export";
import type { CustomFieldDef, ViewDefinition, WorkspaceSnapshot } from "../../src/core/types";
import { task } from "./fixtures";

const fields: CustomFieldDef[] = [
	{ id: "f-points", key: "CF-0001", slug: "points", name: "Points", type: "number" },
	{
		id: "f-client",
		key: "CF-0002",
		slug: "client",
		name: "Client",
		type: "select",
		options: [
			{ id: "o-acme", name: "Acme Corp", color: "#000" },
			{ id: "o-glob", name: "Globex", color: "#111" },
		],
	},
	{ id: "f-due", key: "CF-0003", slug: "due-to-client", name: "Due to client", type: "date" },
	{ id: "f-ok", key: "CF-0004", slug: "signed-off", name: "Signed off", type: "checkbox" },
	{ id: "f-notes", key: "CF-0005", slug: "notes", name: "Notes", type: "text" },
	// Named like a built-in: only ever `custom.status`.
	{ id: "f-status", key: "CF-0006", slug: "status", name: "Status", type: "text" },
	{ id: "f-owner", key: "CF-0007", slug: "owner", name: "Owner", type: "member" },
];

function withFields(): WorkspaceSnapshot {
	const base = sampleSnapshot();
	const someone = base.workspace.people[0]?.id ?? "p1";
	const tasks = [
		task({ path: "t1", id: "T-1", title: "One", rank: "0|hzzzzz:", fields: { "f-points": 8, "f-client": "o-acme", "f-due": "2026-11-01", "f-ok": true, "f-notes": "Waiting on legal", "f-owner": [someone] } }),
		task({ path: "t2", id: "T-2", title: "Two", rank: "0|i00000:", fields: { "f-points": 3, "f-client": "o-glob", "f-due": "2026-10-15", "f-status": "blocked" } }),
		task({ path: "t3", id: "T-3", title: "Three", rank: "0|i00001:", fields: {} }),
		task({ path: "t4", id: "T-4", title: "Four", rank: "0|i00002:", fields: { "f-points": 13 } }),
	];
	return { ...base, tasks, customFields: fields };
}

const snapshot = withFields();
const qctx = queryContext(snapshot);
const vctx = snapshotContext(snapshot);
const run = (source: string) => {
	const parsed = parseQuery(source, qctx);
	return { parsed, ids: applyFilters(snapshot.tasks, parsed.definition.filters, vctx).map((t) => t.id) };
};

describe("custom fields in the query language", () => {
	it("filters by choice name, number, comparison, day, checkbox and text", () => {
		expect(run("custom.client:acme corp").ids).toEqual([]); // two words: quote them
		expect(run('custom.client:"acme corp"').ids).toEqual(["T-1"]);
		expect(run("custom.client:globex,\"Acme Corp\"").ids).toEqual(["T-1", "T-2"]);
		expect(run("custom.points:>3").ids).toEqual(["T-1", "T-4"]);
		expect(run("custom.points:<=8").ids).toEqual(["T-1", "T-2"]);
		expect(run("custom.points:13").ids).toEqual(["T-4"]);
		expect(run("custom.due-to-client:<2026-11-01").ids).toEqual(["T-2"]);
		expect(run("custom.signed-off:yes").ids).toEqual(["T-1"]);
		expect(run("custom.signed-off:no").ids).toEqual(["T-2", "T-3", "T-4"]);
		expect(run("custom.notes:LEGAL").ids).toEqual(["T-1"]);
	});

	it("reads unset, any value (-…:unset) and exclusions", () => {
		expect(run("custom.points:unset").ids).toEqual(["T-3"]);
		expect(run("-custom.points:unset").ids).toEqual(["T-1", "T-2", "T-4"]);
		// One spelling for every field: field:value, no has:.
		expect(parseQuery("has:custom.points", qctx).ok).toBe(false);
		expect(run("-custom.client:globex").ids).toEqual(["T-1", "T-3", "T-4"]);
		expect(run("custom.points:>1 custom.client:globex").ids).toEqual(["T-2"]);
	});

	it("keeps a field named like a built-in apart from the built-in", () => {
		const { parsed, ids } = run("custom.status:blocked");
		expect(parsed.ok).toBe(true);
		expect(ids).toEqual(["T-2"]);
		expect(parsed.definition.filters.status).toBeUndefined();
	});

	it("never takes a bare name for a custom field, and says when a custom field isn't one", () => {
		expect(parseQuery("points:3", qctx).ok).toBe(false);
		const typo = parseQuery("custom.pionts:3", qctx);
		expect(typo.ok).toBe(false);
		expect(typo.issues[0]).toMatchObject({ code: "unknown-field", suggestion: "custom.points" });
		expect(parseQuery("custom.client:>2", qctx).ok).toBe(false);
	});

	it("matches people, and me", () => {
		const person = snapshot.workspace.people[0];
		if (!person) return;
		expect(run(`custom.owner:${JSON.stringify(person.name)}`).ids).toEqual(["T-1"]);
		const mine = applyFilters(snapshot.tasks, parseQuery("custom.owner:me", qctx).definition.filters, snapshotContext(snapshot, person.id));
		expect(mine.map((t) => t.id)).toEqual(["T-1"]);
	});

	it("prints what it parses, by name, and stores the field's key", () => {
		const source = 'custom.client:"Acme Corp",globex -custom.points:unset custom.due-to-client:>=2026-10-01 -custom.notes:unset custom.signed-off:yes custom.status:blocked';
		const parsed = parseQuery(source, qctx);
		expect(parsed.ok).toBe(true);
		expect(parsed.definition.filters.custom?.[0]).toEqual({ field: "CF-0002", matches: [{ op: "eq", value: "o-acme" }, { op: "eq", value: "o-glob" }] });
		const printed = printQuery(parsed.definition, qctx);
		expect(printed).toContain('custom.client:"Acme Corp",Globex');
		expect(printed).toContain("-custom.points:unset");
		expect(printed).toContain("-custom.notes:unset");
		expect(parseQuery(printed, qctx).definition).toEqual(parsed.definition);
	});

	it("prints a renamed field's new name, from the same stored key", () => {
		const parsed = parseQuery("custom.points:>3 sort:-custom.points hide:custom.points", qctx);
		const renamed = { ...qctx, customFields: fields.map((field) => (field.key === "CF-0001" ? { ...field, slug: "story-points" } : field)) };
		const printed = printQuery(parsed.definition, renamed);
		expect(printed).toContain("custom.story-points:>3");
		expect(printed).toContain("sort:-custom.story-points");
		expect(printed).toContain("hide:custom.story-points");
	});

	it("reads a name a field had before a rename, and prints its name now", () => {
		const renamed = { ...qctx, customFields: fields.map((field) => (field.key === "CF-0001" ? { ...field, slug: "story-points", formerSlugs: ["points"] } : field)) };
		const parsed = parseQuery("custom.points:>3 sort:custom.points", renamed);
		expect(parsed.ok).toBe(true);
		expect(parsed.definition.filters.custom?.[0].field).toBe("CF-0001");
		expect(printQuery(parsed.definition, renamed)).toContain("custom.story-points:>3");
		// Another field now called that wins over the old name.
		const taken = { ...renamed, customFields: [...renamed.customFields, { id: "f-new", key: "CF-0099", slug: "points", name: "Points", type: "number" as const }] };
		expect(parseQuery("custom.points:1", taken).definition.filters.custom?.[0].field).toBe("CF-0099");
	});

	it("falls back to the key without the field list, and reads it back", () => {
		const parsed = parseQuery("custom.points:>3", qctx);
		const bare = { ...qctx, customFields: undefined };
		expect(printQuery(parsed.definition, bare)).toContain("custom.cf-0001:>3");
		expect(parseQuery("custom.cf-0001:>3", qctx).definition.filters).toEqual(parsed.definition.filters);
	});
});

describe("sorting and hiding custom fields", () => {
	const ids = (definition: ViewDefinition) =>
		sortTasks(snapshot.tasks, definition.sortBy, definition.sortDirection, vctx).map((t) => t.id);

	it("sorts numbers, unset last either way", () => {
		const asc = parseQuery("sort:custom.points", qctx).definition;
		expect(asc.sortBy).toBe("field:CF-0001");
		expect(ids(asc)).toEqual(["T-2", "T-1", "T-4", "T-3"]);
		expect(ids(parseQuery("sort:-custom.points", qctx).definition)).toEqual(["T-4", "T-1", "T-2", "T-3"]);
	});

	it("sorts choices in their order, and days", () => {
		expect(ids(parseQuery("sort:custom.client", qctx).definition)).toEqual(["T-1", "T-2", "T-3", "T-4"]);
		expect(ids(parseQuery("sort:custom.due-to-client", qctx).definition)).toEqual(["T-2", "T-1", "T-3", "T-4"]);
	});

	it("hides a custom field after the built-in ones", () => {
		const parsed = parseQuery("hide:custom.points,labels", qctx).definition;
		expect(parsed.hiddenFields).toEqual(["labels", "field:CF-0001"]);
		expect(canonicalizeDefinition({ ...DEFAULT_DEFINITION, hiddenFields: ["field:CF-0001", "labels", "field:CF-0001"] }).hiddenFields).toEqual([
			"labels",
			"field:CF-0001",
		]);
	});
});

describe("which custom fields a view shows", () => {
	const shown = (source: string, tasks = snapshot.tasks) => {
		const definition = parseQuery(source, qctx).definition;
		return shownCustomFields(definition, tasks, vctx).map((field) => field.slug);
	};

	it("shows the fields in use, in their order, and none nobody has filled in", () => {
		expect(shown("")).toEqual(["points", "client", "due-to-client", "signed-off", "notes", "status", "owner"]);
		const three = snapshot.tasks.filter((t) => t.id === "T-3" || t.id === "T-4");
		expect(shown("", three)).toEqual(["points"]);
	});

	it("shows a field the view filters or sorts by, even with no values", () => {
		const empty = snapshot.tasks.filter((t) => t.id === "T-3");
		expect(shown("", empty)).toEqual([]);
		expect(shown("sort:custom.client", empty)).toEqual(["client"]);
		expect(shown("custom.notes:unset", empty)).toEqual(["notes"]);
	});

	it("leaves out what the view hides", () => {
		expect(shown("hide:custom.points,custom.notes")).toEqual(["client", "due-to-client", "signed-off", "status", "owner"]);
	});
});

describe("custom fields in exports", () => {
	const exported = (format: "csv" | "json") =>
		buildExport({ snapshot, context: vctx, scope: { kind: "workspace" }, format, fields: ["id", "title", "status"], today: "2026-10-08", includeArchived: false, pluginVersion: "test" }).content;

	it("adds a CSV column per field, by name, '(custom)' where a built-in column has it", () => {
		const [header, first] = exported("csv").replace(/^﻿/, "").split("\r\n");
		expect(header).toBe("ID,Title,Status,Points,Client,Due to client,Signed off,Notes,Status (custom),Owner");
		const person = snapshot.workspace.people[0]?.name ?? "";
		expect(first).toContain(`8,Acme Corp,2026-11-01,Yes,Waiting on legal,,${person}`);
	});

	it("keeps JSON's values by field id, and names the fields", () => {
		const json = JSON.parse(exported("json"));
		expect(json.customFields.map((field: { key: string }) => field.key)).toEqual(fields.map((field) => field.key));
		expect(json.tasks[0].fields["f-points"]).toBe(8);
	});
});
