import { describe, expect, it } from "vitest";
import {
	KIND_SPECS,
	RESULT_KINDS,
	indexKindItems,
	kindField,
	matchesKindQuery,
	parseKindQuery,
	withKinds,
	type KindItem,
} from "../../src/core/query";

// T-0735: one query across kinds -- workspace search, shared links, forms.

const items: KindItem[] = [
	{ kind: "project", key: "P-0001", name: "Website", fields: { status: ["In Progress", "s2"], created: "2026-09-01T10:00:00.000Z" }, links: { space: ["S-0001"] } },
	{ kind: "project", key: "P-0002", name: "Billing", fields: { status: ["Todo", "s1"] }, links: { space: [] } },
	{ kind: "milestone", key: "R-0001", name: "Launch", fields: { state: ["active", "in progress"], target: "2026-11-01" }, links: { space: ["S-0001"] } },
	{
		kind: "task",
		key: "T-0001",
		name: "Write the homepage",
		fields: { status: ["Done", "s3"], due: "2026-10-20" },
		links: { project: ["P-0001"], milestone: ["R-0001"], label: ["L-0001"], member: ["M-0001"], space: ["S-0001"] },
	},
	{ kind: "task", key: "T-0002", name: "Send invoices", fields: { status: ["Todo", "s1"] }, links: { project: ["P-0002"], label: [], member: [] } },
	{ kind: "task", key: "T-0003", name: "Loose end", fields: { status: ["Todo", "s1"] }, links: { project: [], label: [], member: [] } },
	{ kind: "doc", key: "N-0001", name: "Website brief", fields: { status: ["Draft"], type: ["page"], shared: true }, links: { project: ["P-0001"], member: ["M-0001"] } },
	{ kind: "label", key: "L-0001", name: "copy", fields: { color: ["#ff0000", "red"] } },
	{ kind: "space", key: "S-0001", name: "Client work", fields: { visibility: ["open"] } },
	{ kind: "member", key: "M-0001", name: "JR", fields: { email: ["jr@example.com"], role: ["owner"] } },
];
const context = { index: indexKindItems(items), self: ["M-0001"] };

const keys = (source: string) => {
	const parsed = parseKindQuery(source);
	expect(parsed.issues.filter((issue) => issue.severity === "error")).toEqual([]);
	return items.filter((item) => matchesKindQuery(item, parsed.query, context)).map((item) => item.key);
};

describe("the field registry", () => {
	it("gives every kind a key, a name (title reads as it), created and updated", () => {
		for (const kind of RESULT_KINDS) {
			expect(kindField(kind, "key")?.token).toBe("key");
			expect(kindField(kind, "title")?.token).toBe("name");
			expect(kindField(kind, "created")?.type).toBe("date");
			expect(kindField(kind, "updated")?.type).toBe("date");
			expect(KIND_SPECS[kind].kind).toBe(kind);
		}
	});

	it("tags each link with the kind it links to", () => {
		expect(kindField("task", "project")).toMatchObject({ type: "link", links: "project" });
		expect(kindField("doc", "owner")).toMatchObject({ type: "link", links: "member" });
		expect(kindField("project", "space")).toMatchObject({ type: "link", links: "space" });
	});
});

describe("kind: picks what comes back", () => {
	it("narrows to the kinds named, and - leaves them out", () => {
		expect(keys("kind:project")).toEqual(["P-0001", "P-0002"]);
		expect(keys("kind:project,label")).toEqual(["P-0001", "P-0002", "L-0001"]);
		expect(keys("-kind:task,project,milestone,doc")).toEqual(["L-0001", "S-0001", "M-0001"]);
	});

	it("refuses a kind the bar doesn't find", () => {
		const parsed = parseKindQuery("kind:label", { kinds: ["task", "project"] });
		expect(parsed.ok).toBe(false);
	});

	it("reads a value that isn't a kind as a type, as task queries do", () => {
		expect(parseKindQuery("kind:page").query.clauses[0]).toMatchObject({ of: null, field: "type", values: ["page"] });
		expect(keys("kind:page")).toEqual(["N-0001"]);
	});
});

describe("a plain field is each item's own", () => {
	it("matches every kind with that field, and no kind without it", () => {
		expect(keys("status:todo")).toEqual(["P-0002", "T-0002", "T-0003"]);
		expect(keys("status:draft")).toEqual(["N-0001"]);
		// A milestone's state reads as its status; a member with none isn't todo.
		expect(keys("-status:todo")).toEqual(["P-0001", "R-0001", "T-0001", "N-0001", "M-0001"]);
		expect(keys("-status:todo kind:label")).toEqual([]);
	});

	it("follows link fields by key or name, with unset and any", () => {
		// The Space itself, and what's in it.
		expect(keys("space:S-0001")).toEqual(["P-0001", "R-0001", "T-0001", "S-0001"]);
		expect(keys('space:"client work"')).toEqual(["P-0001", "R-0001", "T-0001", "S-0001"]);
		expect(keys("kind:task label:unset")).toEqual(["T-0002", "T-0003"]);
		expect(keys("kind:task assignee:me")).toEqual(["T-0001"]);
		expect(keys("owner:me")).toEqual(["N-0001"]);
	});

	it("reads dates by day, with -before and -after", () => {
		expect(keys("due:2026-10-20")).toEqual(["T-0001"]);
		expect(keys("due-before:2026-10-21")).toEqual(["T-0001"]);
		expect(keys("kind:task due:unset")).toEqual(["T-0002", "T-0003"]);
		expect(keys("created-after:2026-08-31")).toEqual(["P-0001"]);
	});

	it("reads flags as yes or no", () => {
		expect(keys("shared:yes")).toEqual(["N-0001"]);
	});
});

describe("{kind}.{field} matches that kind and what's linked to it", () => {
	it("finds the project and its tasks and docs by the project's name", () => {
		expect(keys("project.name:website")).toEqual(["P-0001", "T-0001", "N-0001"]);
		expect(keys("project.title:website")).toEqual(keys("project.name:website"));
	});

	it("finds a milestone's tasks by its dates", () => {
		expect(keys("milestone.target-before:2026-12-01")).toEqual(["R-0001", "T-0001"]);
		expect(keys("kind:task milestone.state:active")).toEqual(["T-0001"]);
	});

	it("reads {kind}: as {kind}.key:, by key or name", () => {
		expect(keys("project:P-0001")).toEqual(["P-0001", "T-0001", "N-0001"]);
		expect(keys("project:billing")).toEqual(["P-0002", "T-0002"]);
		expect(keys("kind:task project:unset")).toEqual(["T-0003"]);
		expect(keys("kind:task -project:P-0001")).toEqual(["T-0002", "T-0003"]);
		expect(keys("label.color:red")).toEqual(["T-0001", "L-0001"]);
	});

	it("says what a kind has when it hasn't the field", () => {
		const parsed = parseKindQuery("label.status:done");
		expect(parsed.ok).toBe(false);
		expect(parsed.issues[0].message).toContain("Label has no");
	});

	it("says an unknown field isn't one", () => {
		expect(parseKindQuery("colour:red").ok).toBe(false);
	});
});

describe("words", () => {
	it("match a name, key or text, with the fields", () => {
		expect(keys("website")).toEqual(["P-0001", "N-0001"]);
		expect(keys("kind:doc website")).toEqual(["N-0001"]);
	});
});

describe("withKinds: the kind chip writes the query's kind:", () => {
	it("sets, replaces and clears it, leaving the rest as typed", () => {
		expect(withKinds("status:todo", ["project"])).toBe("kind:project status:todo");
		expect(withKinds("kind:task status:todo", ["project", "doc"])).toBe("kind:project,doc status:todo");
		expect(withKinds("status:todo kind:task", [])).toBe("status:todo");
		expect(withKinds('name:"two  spaces" kind:doc', [])).toBe('name:"two  spaces"');
		expect(withKinds("kind:bug", ["task"])).toBe("kind:task kind:bug");
	});
});

describe("what isn't a field", () => {
	it("is unknown whether it has a value or not, so words with colons stay words", () => {
		expect(parseKindQuery("Re: launch").issues[0].code).toBe("unknown-field");
		expect(parseKindQuery("status:").issues[0].code).toBe("empty-value");
	});
});

describe("shared links (T-0729)", () => {
	const links: KindItem[] = [
		{ kind: "link", key: "a", name: "Intake form", fields: { type: ["form"], access: ["public"], status: ["on"], "last-viewed": "2026-06-01T00:00:00.000Z", expires: "2027-01-01" }, links: { member: ["M-0001"] } },
		{ kind: "link", key: "b", name: "Roadmap view", fields: { type: ["view"], access: ["invited"], status: ["off"], "last-viewed": null, expires: null }, links: { member: ["M-0002"] } },
	];
	const ctx = { index: indexKindItems(links), self: ["M-0001"] };
	const find = (source: string) => {
		const parsed = parseKindQuery(source, { kinds: ["link"] });
		expect(parsed.issues).toEqual([]);
		return links.filter((item) => matchesKindQuery(item, parsed.query, ctx)).map((item) => item.key);
	};

	it("reads by:, type:, access:, status:, last-viewed and expires", () => {
		expect(find("by:me")).toEqual(["a"]);
		expect(find("type:form,view access:public")).toEqual(["a"]);
		expect(find("status:off")).toEqual(["b"]);
		expect(find("last-viewed-before:2026-09-01")).toEqual(["a"]);
		expect(find("last-viewed:unset")).toEqual(["b"]);
		expect(find("expires:unset")).toEqual(["b"]);
		expect(find("expires-before:2027-06-01")).toEqual(["a"]);
	});
});
