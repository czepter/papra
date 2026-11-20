export type DropPlacement = 'before' | 'after';

/**
 * Moves `id` next to `targetId` (before or after it) and returns the new order.
 * Returns the list unchanged when either id is unknown or the move is a no-op.
 */
export function moveIdNextToTarget({
  ids,
  id,
  targetId,
  placement,
}: {
  ids: string[];
  id: string;
  targetId: string;
  placement: DropPlacement;
}) {
  if (id === targetId || !ids.includes(id) || !ids.includes(targetId)) {
    return ids;
  }

  const withoutMoved = ids.filter((currentId) => currentId !== id);
  const targetIndex = withoutMoved.indexOf(targetId);
  const insertIndex = placement === 'before' ? targetIndex : targetIndex + 1;

  return [...withoutMoved.slice(0, insertIndex), id, ...withoutMoved.slice(insertIndex)];
}

/** Returns the neighbour to drop next to to move `id` one step up (-1) or down (1), if any. */
export function getMoveByOffsetTarget({
  ids,
  id,
  offset,
}: {
  ids: string[];
  id: string;
  offset: -1 | 1;
}): { targetId: string; placement: DropPlacement } | undefined {
  const index = ids.indexOf(id);
  const targetId = ids[index + offset];

  if (index === -1 || targetId === undefined) {
    return undefined;
  }

  return { targetId, placement: offset === -1 ? 'before' : 'after' };
}
