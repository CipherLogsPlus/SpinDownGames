/** Calendar dates are labels, never timers or automatic publishing triggers. */
export function validReleaseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function releaseLabel(value) {
  return validReleaseDate(value)
    ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
      .format(new Date(value + "T00:00:00.000Z"))
    : "Coming soon";
}
