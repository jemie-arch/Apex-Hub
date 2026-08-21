/** Join class names, dropping falsey ones. No dependency needed for this. */
export function cn(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(' ');
}
