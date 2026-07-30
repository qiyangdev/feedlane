export function etagsWeaklyMatch(left, right) {
  if (left === null || right === null) return false;
  return stripWeakPrefix(left) === stripWeakPrefix(right);
}

function stripWeakPrefix(value) {
  return value.replace(/^W\//, "");
}
