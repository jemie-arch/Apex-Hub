/**
 * Turning "@apex the calendar sync is dead again #urgent" into a ticket.
 *
 * Pure, so `npm run check:slack` can pin every one of these decisions without a
 * workspace, a database or a network. The route does the parts that need those.
 *
 * WHAT IT WILL NOT DO
 *
 * It will not guess the client. Matching practice names against message text is
 * exactly the technique the reconciliation page exists to clean up after, and a
 * ticket filed against the wrong practice is worse than one filed against none.
 *
 * It will not guess the priority. "asap", "urgent", "when you get a sec" are
 * how people write, not how they triage; a field populated by reading tone is a
 * field nobody can trust. Only an explicit #urgent / #high / #low / #normal tag
 * sets it, and the tag is removed from the text so it does not read as part of
 * the request.
 *
 * It will not invent a title. A bare mention with nothing after it produces a
 * null title and the route refuses it, rather than filing "(no description)"
 * and letting somebody discover on Thursday that nobody knew what was asked.
 */

/** Longer than this and the Requests table stops being scannable. */
const TITLE_LIMIT = 120;

export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface MentionDraft {
  /** Null when the mention carried no words of its own. */
  title: string | null;
  /** The whole message, cleaned. Null when it says nothing the title does not. */
  body: string | null;
  priority: TicketPriority;
  /** Slack user ids referenced in the text, for the caller to resolve if it wants. */
  mentionedUserIds: string[];
}

export interface ParseOptions {
  /** The bot's own user id, so `<@B…>` is stripped rather than read as content. */
  botUserId?: string | null;
  /** Slack user id → display name, when the caller has already looked them up. */
  names?: Record<string, string>;
}

/**
 * Slack escapes exactly these three, and only these three, in message text.
 * Decoding more would corrupt a message that legitimately contains `&quot;`.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const PRIORITY_TAGS: Record<string, TicketPriority> = {
  urgent: 'urgent',
  high: 'high',
  normal: 'normal',
  low: 'low',
};

/**
 * Pulls a #priority tag out and returns the text without it.
 *
 * Last tag wins, because somebody who types `#low ... #urgent` has changed
 * their mind mid-sentence and the later word is the one they meant.
 */
function takePriority(text: string): { text: string; priority: TicketPriority } {
  let priority: TicketPriority = 'normal';

  const stripped = text.replace(/(^|\s)#(urgent|high|normal|low)\b/gi, (match, lead: string, tag: string) => {
    priority = PRIORITY_TAGS[tag.toLowerCase()] ?? 'normal';
    // Keep the leading whitespace so words either side do not fuse together.
    return lead;
  });

  return { text: stripped, priority };
}

/**
 * Slack's link syntax, rendered as something readable in a browser.
 *
 * `<https://x|the docs>` becomes "the docs (https://x)" rather than just "the
 * docs". A tech ticket that mentions a link and then loses it is a ticket
 * somebody has to go back to Slack to act on, which defeats the point of
 * filing it.
 */
function renderLinks(text: string): string {
  return text
    // Channel references carry their own name after the pipe.
    .replace(/<#(C[A-Z0-9]+)\|([^>]*)>/g, (_match, _id: string, name: string) =>
      name ? `#${name}` : '#channel',
    )
    // Special mentions: <!here>, <!channel>, <!subteam^S123|@team>.
    .replace(/<!(?:subteam\^)?([^|>]+)(?:\|([^>]*))?>/g, (_match, id: string, label: string) =>
      label || `@${id}`,
    )
    .replace(/<((?:https?|mailto):[^|>]+)\|([^>]*)>/g, (_match, url: string, label: string) => {
      const clean = label.trim();
      if (clean === '' || clean === url) return url;
      // mailto:someone@x rendered with the address as the label is the common
      // case and repeating it reads as a mistake.
      if (url === `mailto:${clean}`) return clean;
      return `${clean} (${url})`;
    })
    .replace(/<((?:https?|mailto):[^|>]+)>/g, (_match, url: string) =>
      url.startsWith('mailto:') ? url.slice('mailto:'.length) : url,
    );
}

/** Every `<@U…>` in the text, deduplicated, in the order they appear. */
export function userIdsIn(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/<@([UWB][A-Z0-9]+)(?:\|[^>]*)?>/g)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

/**
 * Cuts a title at a word boundary rather than mid-word.
 *
 * Falls back to a hard cut when the first "word" is longer than the limit,
 * which happens when somebody pastes a URL as the entire message.
 */
function trimTitle(text: string): string {
  if (text.length <= TITLE_LIMIT) return text;

  const cut = text.slice(0, TITLE_LIMIT);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > TITLE_LIMIT / 2 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

/**
 * A ticket draft from the text of an app_mention.
 *
 * The title is the first line, because that is how people write a request:
 * headline, then detail. When the whole message is one line, title and body are
 * the same thing and the body is left null rather than duplicated.
 */
export function parseMention(rawText: string, options: ParseOptions = {}): MentionDraft {
  const { botUserId = null, names = {} } = options;

  const mentionedUserIds = userIdsIn(rawText).filter((id) => id !== botUserId);

  let text = rawText;

  // The bot's own mention first, wherever it sits. People write "@apex can
  // you…" and "hey can @apex look at…" in roughly equal measure, so removing
  // only a leading one would leave the tag embedded in half the tickets.
  if (botUserId) {
    text = text.replace(new RegExp(`<@${botUserId}(?:\\|[^>]*)?>`, 'g'), ' ');
  }

  // Remaining user mentions become names when the caller resolved them, and a
  // readable @id when it did not — never a raw `<@U…>`, which is markup nobody
  // outside Slack can read.
  text = text.replace(/<@([UWB][A-Z0-9]+)(?:\|([^>]*))?>/g, (_match, id: string, label: string) => {
    const name = names[id] ?? (label || null);
    return name ? `@${name}` : `@${id}`;
  });

  text = renderLinks(text);
  text = decodeEntities(text);

  const withPriority = takePriority(text);
  text = withPriority.text;

  // Collapse runs of spaces and tabs but keep newlines: the line break is what
  // separates the headline from the detail, and losing it would put the whole
  // message in the title.
  const lines = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line, index, all) => !(line === '' && all[index - 1] === ''));

  while (lines.length > 0 && lines[0] === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  if (lines.length === 0) {
    return { title: null, body: null, priority: withPriority.priority, mentionedUserIds };
  }

  const headline = lines[0] ?? '';
  const title = trimTitle(headline);
  const whole = lines.join('\n');

  return {
    title,
    // Only worth storing when it says more than the title already does.
    body: whole === headline ? null : whole,
    priority: withPriority.priority,
    mentionedUserIds,
  };
}
