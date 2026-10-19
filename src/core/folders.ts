/**
 * Hub folder paths in queries (T-0926): `project.folder:"Plan Things Better / Web"`.
 *
 * A folder is named by its path, top folder first, with `/` between the
 * levels; spaces around the `/` don't matter, nor does case. An item is in a
 * folder when the folder is its own or any folder above it, so a folder
 * takes in everything under it however deep. A path matches a run of the
 * item's folder path anywhere along it, so a folder's name alone
 * (`project.folder:Web`) finds every folder of that name, and
 * `Web / Clients` every Clients folder inside a Web.
 */

/** The levels of a folder path, trimmed, without empty ones. */
export function folderSegments(path: string): string[] {
	return path
		.split("/")
		.map((segment) => segment.trim().replace(/\s+/g, " "))
		.filter(Boolean);
}

/** A folder path as it's stored and printed: its levels joined with
 *  ` / `, the way a label's folder is (`TaxonomyValue.path`). */
export function normalizeFolderPath(path: string): string {
	return folderSegments(path).join(" / ");
}

/** Whether an item filed in `folder` (its folder's full path; empty or
 *  missing for none) is in the folder `wanted` names, or one below it. */
export function inFolder(folder: string | null | undefined, wanted: string): boolean {
	if (!folder) return false;
	const have = folderSegments(folder).map((segment) => segment.toLowerCase());
	const want = folderSegments(wanted).map((segment) => segment.toLowerCase());
	if (want.length === 0 || want.length > have.length) return false;
	for (let start = 0; start + want.length <= have.length; start++) {
		if (want.every((segment, index) => have[start + index] === segment)) return true;
	}
	return false;
}
