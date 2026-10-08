/**
 * Everything view evaluation needs to know that isn't the task list itself.
 */

import { scopeOf, type HierarchyScope } from "../hierarchy";
import { workspaceTaxonomies, type WorkspaceTaxonomies } from "../taxonomy";
import type {
	CustomFieldDef,
	LinkTarget,
	Milestone,
	Person,
	WorkspaceConfig,
	WorkspaceSnapshot,
} from "../types";

export interface ViewContext {
	workspace: WorkspaceConfig;
	taxonomies: WorkspaceTaxonomies;
	/**
	 * The roster `Person.id` this device treats as "me" in this workspace, or
	 * null when unset or not in this workspace. Resolving `self` filters is the
	 * whole mechanism behind "Assigned to Me" / "Mentions Me" - the substitute
	 * for a dedicated notification panel in v1.
	 */
	selfId: string | null;
	people: Person[];
	/**
	 * Path → title for projects, so grouping by project can show a name instead
	 * of a path. Absent when a caller builds a context from a bare config rather
	 * than a full snapshot.
	 */
	titles?: Map<LinkTarget, string>;
	/** Path → milestone, so grouping and sorting by milestone can name it and
	 *  order it by its target date. Absent without a full snapshot. */
	milestones?: Map<LinkTarget, Milestone>;
	/**
	 * Sub-task/project rollup scope, for sorts that read computed values
	 * (`progress`). Absent when a caller builds a context from a bare config
	 * rather than a full snapshot - those sorts then compare as unset.
	 */
	scope?: HierarchyScope;
	/** The workspace's custom fields, for clauses and sorts that name one
	 *  (views/custom-fields.ts). Absent without a full snapshot. */
	customFields?: CustomFieldDef[];
}

/** The roster person the given `personId` names, if this workspace has that id. */
export function selfPerson(
	workspace: WorkspaceConfig,
	me: string | null,
): Person | null {
	if (!me) return null;
	return workspace.people.find((person) => person.id === me) ?? null;
}

export function viewContext(
	workspace: WorkspaceConfig,
	me: string | null = null,
): ViewContext {
	return {
		workspace,
		taxonomies: workspaceTaxonomies(workspace),
		selfId: selfPerson(workspace, me)?.id ?? null,
		people: workspace.people,
	};
}

/** The usual entry point: a context that can also name linked entities. */
export function snapshotContext(
	snapshot: WorkspaceSnapshot,
	me: string | null = null,
): ViewContext {
	const titles = new Map<LinkTarget, string>();
	for (const project of snapshot.projects) titles.set(project.path, project.title);
	const milestones = new Map<LinkTarget, Milestone>();
	for (const milestone of snapshot.milestones ?? []) milestones.set(milestone.path, milestone);

	return { ...viewContext(snapshot.workspace, me), titles, milestones, scope: scopeOf(snapshot), customFields: snapshot.customFields };
}

/**
 * Where a milestone sorts: by target date (undated last), then title -- the
 * order milestones come due in, which is how a board's columns or a list's
 * groups should read. `null` for no milestone.
 */
export function milestoneOrderKey(context: ViewContext, path: LinkTarget | null | undefined): string | null {
	if (!path) return null;
	const milestone = context.milestones?.get(path);
	if (!milestone) return `9999-99-99\u0000${path}`;
	return `${milestone.targetDate ?? "9999-99-99"}\u0000${milestone.title.toLowerCase()}`;
}
