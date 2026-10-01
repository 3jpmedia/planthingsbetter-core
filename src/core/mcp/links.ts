/**
 * Where a payload's `url` points: each app opens a task, view or dashboard
 * its own way -- the web app at `/app/<workspace>/tasks/PTB-0149`, the
 * Obsidian plugin at an `obsidian://vertex-flow?…` link it handles itself --
 * so the builders take the app's links rather than building one.
 */
import type { DashboardConfig, SavedView, Task } from "../types";

export interface McpLinks {
	task(task: Task): string;
	view(view: SavedView): string;
	dashboard(dashboard: DashboardConfig): string;
}
