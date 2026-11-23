export function roadPath(cities, from, to, passable, limit = Infinity, edgeAllowed = () => true) {
  if (!cities.has(from) || !cities.has(to)) return null;
  const seen = new Set([from]);
  const queue = [[from]];
  for (const path of queue) {
    const last = path.at(-1);
    if (last === to) return path;
    if (path.length > limit) continue;
    for (const key of cities.get(last).links) {
      if (seen.has(key) || !passable(key) || !edgeAllowed(last, key)) continue;
      seen.add(key);
      queue.push([...path, key]);
    }
  }
  return null;
}
