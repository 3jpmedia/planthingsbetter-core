import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { mergeRepeatedClauses, parseQuery, queryContext } from "../../src/core/query";

/** A field written twice reads as one clause, so the query bar merges the
 *  text too (T-1059). */
const ctx = queryContext(sampleSnapshot());
const same = (a: string, b: string) => expect(parseQuery(a, ctx).definition).toEqual(parseQuery(b, ctx).definition);

describe("mergeRepeatedClauses", () => {
	it("merges a repeated exclusion into the first one", () => {
		expect(mergeRepeatedClauses("-status:done -status:canceled")).toBe("-status:done,canceled");
	});

	it("merges a repeated include, and leaves the rest as typed", () => {
		const source = "layout:board status:todo assignee:me status:done sort:-due";
		const merged = mergeRepeatedClauses(source);
		expect(merged).toBe("layout:board status:todo,done assignee:me sort:-due");
		same(source, merged);
	});

	it("keeps includes and exclusions of a field apart", () => {
		expect(mergeRepeatedClauses("status:todo -status:done")).toBe("status:todo -status:done");
	});

	it("merges several repeats, keeping quotes and = as written and leaving out a value written again", () => {
		const source = 'label:"Needs JR" -status:done label:=bug -status:done,blocked label:"Needs JR"';
		const merged = mergeRepeatedClauses(source);
		expect(merged).toBe('label:"Needs JR",=bug -status:done,blocked');
		same(source, merged);
	});

	it("counts a field's other spellings as the same field", () => {
		expect(mergeRepeatedClauses("status:todo task.status:done")).toBe("status:todo,done");
	});

	it("leaves custom fields, text, layout clauses and a lone any as they are", () => {
		for (const source of [
			"custom.points:3 custom.points:5",
			"text:launch text:plan",
			"sort:due sort:-due",
			"label:any label:bug",
			"launch plan",
		]) {
			expect(mergeRepeatedClauses(source)).toBe(source);
		}
	});

	it("reads the same as what it merged, with no warning left", () => {
		const source = "-status:done project:any -status:canceled is:open";
		const merged = mergeRepeatedClauses(source);
		expect(merged).toBe("-status:done,canceled project:any is:open");
		same(source, merged);
		expect(parseQuery(source, ctx).issues).toEqual([]);
	});
});
