import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { parseQuery, printFilters, printQuery, queryContext } from "../../src/core/query";
import { parseActivityQuery, printActivityQuery } from "../../src/core/activity";
import { applyFilters, snapshotContext } from "../../src/core/views";
import legacy from "./fixtures/queries-before-t0728.json";

// T-0728: one form for the whole query language. Every spelling the grammar
// accepted before still means exactly what it did -- views, dashboards and
// docs store query text, and none of it is rewritten -- while the printer
// writes the new form.

const snapshot = sampleSnapshot();
const ctx = queryContext(snapshot);

describe("every spelling from before T-0728 keeps its meaning", () => {
	// queries-before-t0728.json: each spelling of each field the grammar
	// accepted (tokens and aliases, excluded, `unset`, `any`, sorts, groups,
	// hidden fields, mixed case), with what the parser made of it then.
	for (const { text, ok, definition } of legacy.parsedQueries) {
		it(text, () => {
			const parsed = parseQuery(text, ctx);
			expect(parsed.ok).toBe(ok);
			expect(parsed.definition).toEqual(definition);
		});
	}

	it("re-reads what the old printer wrote", () => {
		for (const { text, definition } of legacy.printed) {
			expect(parseQuery(text, ctx).definition).toEqual(definition);
		}
	});
});

describe("the new form means the same as the spelling it replaces", () => {
	const project = ctx.projects[0].title;
	const pairs: [string, string][] = [
		["taskTitle:launch", "name:launch"],
		["taskTitle:launch", "task.name:launch"],
		["taskTitle:launch", "task.title:launch"],
		[`projectKey:"${project}"`, `project:"${project}"`],
		[`projectKey:"${project}"`, `project.key:"${project}"`],
		[`projectKey:"${project}"`, `task.project:"${project}"`],
		["taskParentKey:unset", "parent:unset"],
		["taskParentKey:unset", "parent.key:unset"],
		["taskRootKey:any", "root:any"],
		["taskKey:unset", "task:unset"],
		["taskKey:unset", "task.key:unset"],
		["blocksTaskKey:any", "blocks:any"],
		["blockedByTaskKey:any", "blocked-by:any"],
		["blockedByTaskKey:any", "task.blocked-by:any"],
		["relatedTaskKey:unset", "related:unset"],
		["taskStarted:any", "started:any"],
		["taskStartedBefore:2026-09-01", "started-before:2026-09-01"],
		["taskStartedAfter:2026-09-01", "task.started-after:2026-09-01"],
		["milestoneTarget:unset", "milestone.target:unset"],
		["milestoneTargetBefore:2026-11-01", "milestone.target-before:2026-11-01"],
		["milestoneStartAfter:2026-09-01", "milestone.start-after:2026-09-01"],
		["milestoneCompleted:any", "milestone.completed:any"],
		["projectDue:2026-10-20", "project.due:2026-10-20"],
		["projectCreatedAfter:2026-09-01", "project.created-after:2026-09-01"],
		["projectUpdatedBefore:2026-09-01", "project.updated-before:2026-09-01"],
		["status:done", "task.status:done"],
		["-label:unset", "-task.label:unset"],
		["sort:taskStarted", "sort:started"],
		["sort:-title", "sort:-name"],
		["sort:due", "sort:task.due"],
		["hide:project", "hide:task.project"],
	];
	for (const [before, after] of pairs) {
		it(`${after} = ${before}`, () => {
			const old = parseQuery(before, ctx);
			const now = parseQuery(after, ctx);
			expect(old.ok).toBe(true);
			expect(now.issues.filter((issue) => issue.severity === "error")).toEqual([]);
			expect(now.definition).toEqual(old.definition);
		});
	}
});

describe("the printer writes the new form", () => {
	it("prints plain fields and {kind}.{field}, never the old camelCase", () => {
		const parsed = parseQuery(
			"taskTitle:launch taskParentKey:unset taskRootKey:any taskKey:any blockedByTaskKey:any relatedTaskKey:unset taskStarted:any taskStartedBefore:2026-09-01 milestoneTargetBefore:2026-11-01 projectDue:unset sort:taskStarted",
			ctx,
		);
		const printed = printQuery(parsed.definition, ctx);
		expect(printed).not.toMatch(/taskTitle|taskParentKey|taskRootKey|taskKey|blockedByTaskKey|relatedTaskKey|taskStarted|milestoneTarget|projectDue|projectKey/);
		for (const clause of ["name:launch", "parent:unset", "root:any", "task:any", "blocked-by:any", "related:unset", "started:any", "started-before:2026-09-01", "milestone.target-before:2026-11-01", "project.due:unset", "sort:started"]) {
			expect(printed).toContain(clause);
		}
		expect(parseQuery(printed, ctx).definition).toEqual(parsed.definition);
	});

	it("prints a project as project:, by its key", () => {
		const printed = printFilters({ project: [snapshot.projects[0].path] }, ctx);
		expect(printed.startsWith("project:")).toBe(true);
	});
});

describe("{kind}.name: a linked item's name", () => {
	const context = snapshotContext(snapshot);
	const withProject = snapshot.tasks.find((task) => task.project);
	const projectTitle = withProject ? snapshot.projects.find((p) => p.path === withProject.project)?.title : undefined;

	it("parses and prints project.name, milestone.name, space.name, label.name and assignee.name", () => {
		const parsed = parseQuery('project.name:web milestone.title:"launch week" space.name:client label.name:bug assignee.name:ann', ctx);
		expect(parsed.ok).toBe(true);
		expect(parsed.definition.filters).toMatchObject({ projectName: "web", milestoneName: "launch week", spaceName: "client", labelName: "bug", assigneeName: "ann" });
		const printed = printFilters(parsed.definition.filters, ctx);
		expect(printed).toContain("project.name:web");
		expect(printed).toContain('milestone.name:"launch week"');
		expect(parseQuery(printed, ctx).definition.filters).toEqual(parsed.definition.filters);
	});

	it("matches tasks whose project's name contains the text, case-insensitively", () => {
		expect(projectTitle).toBeTruthy();
		const needle = projectTitle!.slice(1, 4).toUpperCase();
		const found = applyFilters(snapshot.tasks, { projectName: needle }, context);
		expect(found.length).toBeGreaterThan(0);
		expect(found.every((task) => task.project === withProject!.project || snapshot.projects.find((p) => p.path === task.project)?.title.toUpperCase().includes(needle))).toBe(true);
		expect(found.some((task) => !task.project)).toBe(false);
	});

	it("matches nothing for a name no project has", () => {
		expect(applyFilters(snapshot.tasks, { projectName: "no project is called this" }, context)).toEqual([]);
	});

	it("can't be excluded, like name:", () => {
		expect(parseQuery("-project.name:web", ctx).ok).toBe(false);
	});
});

describe("kind:", () => {
	it("kind:task is what a task query finds, so it changes nothing", () => {
		const parsed = parseQuery("kind:task status:done", ctx);
		expect(parsed.ok).toBe(true);
		expect(parsed.definition).toEqual(parseQuery("status:done", ctx).definition);
	});

	it("another kind isn't something a task query can find", () => {
		const parsed = parseQuery("kind:project", ctx);
		expect(parsed.ok).toBe(false);
		expect(parsed.issues[0].suggestion).toBe("kind:task");
	});

	it("a value that isn't a kind is still the older spelling of type:", () => {
		expect(parseQuery("kind:bug", ctx).definition).toEqual(parseQuery("type:bug", ctx).definition);
	});
});

describe("Activity's clauses", () => {
	const actx = { ...ctx, people: [{ id: "u1", name: "Bea", email: "bea@example.com" }] };
	it("print as activity.<field>, and the older spellings mean the same", () => {
		const old = parseActivityQuery("activityBy:bea@example.com activityItem:task activity-after:2026-09-01 activityAction:created", actx);
		const now = parseActivityQuery("activity.by:bea@example.com activity.kind:task activity.after:2026-09-01 activity.action:created", actx);
		expect(now.ok).toBe(true);
		expect(now.query).toEqual(old.query);
		const printed = printActivityQuery(now.query, actx);
		expect(printed).toContain("activity.by:");
		expect(printed).not.toMatch(/activityBy|activityItem|activity-after|activityAction/);
	});
});
