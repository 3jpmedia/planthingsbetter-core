/**
 * Ported from vertex-flow-obsidian's src/ui/tabs-guard.ts (that plugin's own
 * copy is untouched by this port — see planthingsbetter-web's tab-strip work).
 * Pure, framework-free: shared by every product's tab provider so
 * reorder-clamping and the unsaved-changes-guard decision behave identically
 * everywhere, rather than drifting between independently-maintained copies.
 *
 *   - No guard registered → never prompt.
 *   - Any navigation (switching/opening a tab, workspace switch) → never
 *     prompt; the draft is safe in the shared store above the tab.
 *   - Closing a tab that isn't the active one → that tab's draft isn't the
 *     one the guard was registered for, never prompt.
 *   - Closing the active, guarded tab → prompt.
 */

export type GuardedAction = "navigate" | "close";

export function shouldPromptUnsavedGuard(input: {
	/** Whether the active tab registered an unsaved-changes check. */
	hasGuard: boolean;
	action: GuardedAction;
	/** The tab being navigated to, or closed. */
	targetId: string;
	activeId: string;
}): boolean {
	if (!input.hasGuard) return false;
	if (input.action !== "close") return false;
	return input.targetId === input.activeId;
}

/**
 * Move the tab `tabId` to sit at gap `toIndex` (an insertion point in the
 * *current* array, `0` = before the first tab).
 *
 * `isPinned`, when given, keeps pinned and unpinned tabs in two contiguous
 * groups (pinned first) the way ordinary browser/Obsidian pinned tabs behave:
 * a pinned tab can't be dropped past the last pinned slot, and an unpinned
 * tab can't be dropped before the first unpinned slot. Omit it to reorder
 * freely, as if there were no pinned tabs at all.
 *
 * Dropping a tab back where it already sits is a no-op — the same array is
 * returned so callers don't re-render for nothing.
 */
export function reorderTabs<T extends { id: string }>(
	tabs: T[],
	tabId: string,
	toIndex: number,
	isPinned?: (id: string) => boolean,
): T[] {
	const from = tabs.findIndex((tab) => tab.id === tabId);
	if (from === -1) return tabs;

	let clamped = toIndex;
	if (isPinned) {
		const pinnedCount = tabs.filter((tab) => isPinned(tab.id)).length;
		clamped = isPinned(tabId)
			? Math.min(toIndex, pinnedCount)
			: Math.max(toIndex, pinnedCount);
	}

	if (clamped === from || clamped === from + 1) return tabs;

	const moved = tabs[from];
	const without = tabs.filter((tab) => tab.id !== tabId);
	// `clamped` indexes the original array; shift left when the removed tab
	// sat before the gap.
	const target = Math.max(
		0,
		Math.min(from < clamped ? clamped - 1 : clamped, without.length),
	);

	without.splice(target, 0, moved);
	return without;
}
