// What a form's input error says about each field, so a page can put the words beside the field. Pure.

export type FieldErrors = Readonly<Record<string, readonly string[]>>;

/** A path into a posted document as words: list positions count from one, as a person counts them. */
export function pathText(path: readonly PropertyKey[]): string {
  return path
    .map((part) => (typeof part === 'number' ? String(part + 1) : String(part)))
    .join(', ')
    .replace(/^(\w+), (\d+)/, '$1 $2');
}

/** The fields that have a message, in the order given; the CSRF token is the page's problem, not a field's. */
export function fieldErrorsOf(
  fields: Readonly<Record<string, readonly string[] | undefined>>,
): FieldErrors {
  const kept: Record<string, readonly string[]> = {};
  for (const [name, messages] of Object.entries(fields)) {
    if (name !== '_csrf' && messages !== undefined && messages.length > 0) kept[name] = messages;
  }
  return kept;
}
