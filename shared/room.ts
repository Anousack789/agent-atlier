import type { Furniture, Point } from "./types";

export const footprints: Record<Furniture["type"], [number, number]> = {
  desk: [4, 1],
  chair: [1, 1],
  plant: [1, 1],
  meeting: [4, 3],
  sofa: [3, 2],
  bookcase: [3, 1],
};
export function occupiedCells(item: Furniture): Point[] {
  const [width, height] = footprints[item.type];
  const cells: Point[] = [];
  for (
    let x = item.x - Math.floor(width / 2);
    x < item.x - Math.floor(width / 2) + width;
    x++
  )
    for (
      let y = item.y - Math.floor(height / 2);
      y < item.y - Math.floor(height / 2) + height;
      y++
    )
      cells.push({ x, y });
  return cells;
}
export function canPlace(item: Furniture, furniture: Furniture[]) {
  const blocked = new Set(
    furniture
      .filter((f) => f.id !== item.id)
      .flatMap(occupiedCells)
      .map((p) => `${p.x},${p.y}`),
  );
  return occupiedCells(item).every(
    (p) =>
      p.x >= 1 &&
      p.x <= 28 &&
      p.y >= 1 &&
      p.y <= 16 &&
      !blocked.has(`${p.x},${p.y}`),
  );
}
export function walkPath(
  start: Point,
  end: Point,
  furniture: Furniture[],
): Point[] {
  const blocked = new Set(
    furniture.flatMap(occupiedCells).map((p) => `${p.x},${p.y}`),
  );
  const key = (p: Point) => `${p.x},${p.y}`;
  const queue = [start];
  const parents = new Map<string, Point | null>([[key(start), null]]);
  let goal: Point | undefined;
  for (let index = 0; index < queue.length; index++) {
    const point = queue[index];
    if (point.x === end.x && point.y === end.y) {
      goal = point;
      break;
    }
    for (const neighbor of [
      { x: point.x + 1, y: point.y },
      { x: point.x - 1, y: point.y },
      { x: point.x, y: point.y + 1 },
      { x: point.x, y: point.y - 1 },
    ]) {
      if (
        neighbor.x < 1 ||
        neighbor.x > 28 ||
        neighbor.y < 3 ||
        neighbor.y > 16 ||
        blocked.has(key(neighbor)) ||
        parents.has(key(neighbor))
      )
        continue;
      parents.set(key(neighbor), point);
      queue.push(neighbor);
    }
  }
  if (!goal) return [];
  const result: Point[] = [];
  let cursor: Point | null = goal;
  while (cursor) {
    result.unshift(cursor);
    cursor = parents.get(key(cursor)) || null;
  }
  return result.slice(1);
}
