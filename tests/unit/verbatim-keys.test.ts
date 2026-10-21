import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { parseQuery, printQuery, queryContext } from "../../src/core/query";
import type { WorkspaceSnapshot } from "../../src/core/types";

// A query read before its Spaces had loaded kept `S-0003` as written, and
// printing that back wrote `space:=S-0003`, which then matched nothing
// (T-0995). A verbatim key reads as the item it names.
function withSpaces(spaces = true): WorkspaceSnapshot {
	const base = sampleSnapshot();
	return {
		...base,
		spaces: spaces
			? [
					{ path: "s-trey", id: "S-0001", title: "Trey's schoolwork" },
					{ path: "s-josiah", id: "S-0002", title: "Josiah's schoolwork" },
				]
			: [],
	};
}

describe("verbatim keys", () => {
	it("reads `=S-0001` as that Space", () => {
		const context = queryContext(withSpaces());
		const { definition } = parseQuery("space:=S-0001,S-0002", context);
		expect(definition.filters.space).toEqual(["s-trey", "s-josiah"]);
		expect(printQuery(definition, context)).toContain("space:S-0001,S-0002");
	});

	it("keeps a key no Space has as written", () => {
		const context = queryContext(withSpaces());
		expect(parseQuery("space:=S-0009", context).definition.filters.space).toEqual(["S-0009"]);
	});

	it("keeps it as written while the Spaces aren't there yet", () => {
		const context = queryContext(withSpaces(false));
		expect(parseQuery("space:=S-0001", context).definition.filters.space).toEqual(["S-0001"]);
	});

	it("still means the value itself when it's stored as is", () => {
		const snapshot = withSpaces();
		snapshot.spaces = [...(snapshot.spaces ?? []), { path: "S-0007", id: "S-0001", title: "Odd one" }];
		const context = queryContext(snapshot);
		expect(parseQuery("space:=S-0007", context).definition.filters.space).toEqual(["S-0007"]);
	});
});
