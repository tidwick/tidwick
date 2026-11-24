// The IANA time zones the runtime knows, for the settings page's list and the check on what it posts.

/** Whether the runtime accepts `name` as a time zone; an alias such as `Europe/Kiev` counts. */
export function isTimeZone(name: string): boolean {
  if (name === '') return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** UTC and every zone the runtime lists, in order, with `current` added when the list leaves it out. */
export function timeZoneChoices(current: string): string[] {
  const listed = ['UTC', ...Intl.supportedValuesOf('timeZone').filter((zone) => zone !== 'UTC')];
  return listed.includes(current) ? listed : [current, ...listed];
}
