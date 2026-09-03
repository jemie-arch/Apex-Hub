'use client';

import { useMemo, useRef, useState, useTransition } from 'react';

import { addTicketComment } from '@/app/(app)/tech-support/actions';
import { Button } from '@/components/ui/Button';
import type { Person } from '@/components/tech/TicketControls';
import { cn } from '@/lib/cn';

export interface TicketComment {
  id: string;
  authorName: string;
  body: string;
  /** Rendered relative by the caller, which owns the timezone. */
  when: string;
  isOwn: boolean;
}

/**
 * The token being typed, if the caret sits in one.
 *
 * "@al" with the caret after the l is a query for "al". "@Ally Smith " with a
 * trailing space is finished and must not reopen the menu, which is why the
 * pattern refuses whitespace — otherwise the picker would pop back up every
 * time somebody typed a sentence containing a previous mention.
 */
function activeMention(value: string, caret: number): { query: string; from: number } | null {
  const before = value.slice(0, caret);
  const match = /(?:^|\s)@([^\s@]*)$/.exec(before);
  if (!match) return null;
  return { query: match[1] ?? '', from: caret - (match[1] ?? '').length - 1 };
}

/**
 * Bolds the names that were actually tagged.
 *
 * Matches against the known people rather than any "@word", so an email address
 * or a stray "@" in a log paste is left alone. Longest name first, so "@Ally
 * Smith" is not matched as "@Ally" with " Smith" left behind.
 */
function withMentions(body: string, names: readonly string[]) {
  if (names.length === 0) return body;

  const ordered = [...names].sort((a, b) => b.length - a.length);
  const escaped = ordered.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`@(?:${escaped.join('|')})`, 'g');

  const parts: Array<string | { mention: string }> = [];
  let cursor = 0;

  for (const match of body.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > cursor) parts.push(body.slice(cursor, at));
    parts.push({ mention: match[0] });
    cursor = at + match[0].length;
  }
  if (cursor < body.length) parts.push(body.slice(cursor));

  return parts.map((part, index) =>
    typeof part === 'string' ? (
      <span key={index}>{part}</span>
    ) : (
      <span key={index} className="rounded bg-accent-subtle px-1 font-medium text-accent">
        {part.mention}
      </span>
    ),
  );
}

/**
 * The conversation on a ticket.
 *
 * Typing @ opens a picker; choosing somebody inserts their name and records
 * their id. The id is what gets stored and what decides who is notified — see
 * the migration for why the text alone is not trusted.
 *
 * Deleting a name from the box before posting drops that mention, because the
 * ids are filtered against what the body still says at submit time. Somebody
 * who tags a person, thinks better of it and deletes the name reasonably
 * expects them not to be pinged.
 */
export function TicketComments({
  ticketId,
  comments,
  people,
}: {
  ticketId: string;
  comments: readonly TicketComment[];
  people: readonly Person[];
}) {
  const [body, setBody] = useState('');
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [menu, setMenu] = useState<{ query: string; from: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);

  const names = useMemo(() => people.map((person) => person.name), [people]);

  const matches = useMemo(() => {
    if (menu === null) return [];
    const query = menu.query.toLowerCase();
    return people
      .filter((person) => person.name.toLowerCase().includes(query))
      .slice(0, 6);
  }, [menu, people]);

  function insert(person: Person) {
    if (menu === null) return;

    const next =
      body.slice(0, menu.from) +
      `@${person.name} ` +
      body.slice(menu.from + menu.query.length + 1);

    setBody(next);
    setPicked((was) => new Map(was).set(person.id, person.name));
    setMenu(null);
    box.current?.focus();
  }

  function submit() {
    const text = body.trim();
    if (text === '') return;

    // Only the people still named in the text. See the note above.
    const mentionedUserIds = [...picked.entries()]
      .filter(([, name]) => text.includes(`@${name}`))
      .map(([id]) => id);

    startTransition(async () => {
      const outcome = await addTicketComment({ ticketId, body: text, mentionedUserIds });
      if (outcome.ok) {
        setBody('');
        setPicked(new Map());
        setError(null);
      } else {
        setError(outcome.message);
      }
    });
  }

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-semibold text-fg">
        Comments{comments.length > 0 ? ` · ${comments.length}` : ''}
      </h2>

      <div className="panel rounded-lg border border-line bg-surface">
        {comments.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-fg-subtle">
            Nothing said yet. Type @ to tag somebody — they will see it in the
            bell at the top of the page.
          </p>
        ) : (
          <ul>
            {comments.map((comment) => (
              <li key={comment.id} className="border-b border-line px-4 py-3 last:border-0">
                <span className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      'text-xs font-semibold',
                      comment.isOwn ? 'text-accent' : 'text-fg',
                    )}
                  >
                    {comment.authorName}
                  </span>
                  <span className="text-[11px] text-fg-subtle">{comment.when}</span>
                </span>
                <p className="mt-1 whitespace-pre-line text-sm text-fg-muted">
                  {withMentions(comment.body, names)}
                </p>
              </li>
            ))}
          </ul>
        )}

        <div className="relative border-t border-line p-3">
          {menu !== null && matches.length > 0 ? (
            <ul className="absolute bottom-full left-3 z-20 mb-1 w-64 overflow-hidden rounded-md border border-line bg-surface shadow-lg">
              {matches.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    // onMouseDown, not onClick: the textarea's blur would fire
                    // first and close the menu before a click ever landed.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      insert(person);
                    }}
                    className="block w-full px-3 py-2 text-left text-xs text-fg hover:bg-surface-sunken"
                  >
                    {person.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <textarea
            ref={box}
            rows={3}
            value={body}
            placeholder="Add a comment. Type @ to tag somebody."
            className="w-full rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm text-fg placeholder:text-fg-subtle"
            onChange={(event) => {
              setBody(event.target.value);
              setMenu(
                activeMention(event.target.value, event.target.selectionStart ?? 0),
              );
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setMenu(null);
              // Enter sends, Shift+Enter breaks the line. The opposite of a
              // document editor, and the right way round for a comment box.
              if (event.key === 'Enter' && !event.shiftKey && menu === null) {
                event.preventDefault();
                submit();
              }
            }}
            onBlur={() => setMenu(null)}
          />

          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-fg-subtle">
              {error ? (
                <span className="text-negative">{error}</span>
              ) : (
                'Enter to post · Shift+Enter for a new line'
              )}
            </span>
            <Button
              variant="primary"
              size="sm"
              disabled={isPending || body.trim() === ''}
              onClick={submit}
            >
              {isPending ? 'Posting…' : 'Comment'}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
