function dropZoneArea(id, droppableRects) {
  const rect = droppableRects.get(id);
  return rect ? rect.width * rect.height : Number.POSITIVE_INFINITY;
}

export function prioritizeDropCollisions(collisions, state, droppableRects = new Map()) {
  const insideCollisions = collisions
    .filter(({ id }) => String(id).startsWith('inside:'))
    .sort((left, right) => (
      dropZoneArea(left.id, droppableRects) - dropZoneArea(right.id, droppableRects)
    ));
  if (!insideCollisions.length) return collisions;

  const inside = insideCollisions[0];
  const parentId = String(inside.id).slice('inside:'.length);
  const childTarget = collisions.find(({ id }) => (
    !String(id).startsWith('inside:')
    && state.byId[String(id)]?.parentId === parentId
  ));
  return childTarget
    ? [childTarget, ...collisions.filter(({ id }) => id !== childTarget.id)]
    : [inside, ...collisions.filter(({ id }) => id !== inside.id)];
}
