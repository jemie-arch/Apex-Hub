/**
 * Who a Slack-raised ticket lands on.
 *
 * THE RULE
 *
 * Tag somebody and it is theirs. Tag nobody and it is Ally's.
 *
 *   @apex the calendar sync is down            -> Ally (the default)
 *   @apex @Ally the calendar sync is down      -> Ally (asked for by name)
 *   @apex @Jemie can you look at this          -> Jemie
 *   @apex @Jemie @Ally one of you              -> Jemie, and Ally is notified
 *
 * WHY ONLY A REAL SLACK MENTION COUNTS
 *
 * "assign this to jemie", typed as words, does not assign to Jemie. It is
 * tempting -- it is obviously what the person meant -- and it is the same class
 * of mistake as matching practice names against message text, which is the
 * technique the reconciliation page exists to clean up after.
 *
 * The problem is that a name in prose carries no intent. These are
 * indistinguishable to a matcher:
 *
 *   "assign this to ayanda"      -> she should own it
 *   "ayanda said this is broken" -> she reported it
 *   "ayanda is out today"        -> she must NOT own it
 *
 * Two of those three would put work on somebody who never agreed to it, and
 * nobody would notice until the ticket aged. A Slack mention is not a name, it
 * is an id the sender chose from a picker -- an explicit act, and the only
 * signal here worth acting on.
 *
 * The cost is that somebody who types a name instead of tagging gets Ally, and
 * has to reassign on the page. That is a visible, cheap correction. A silent
 * misassignment is neither.
 *
 * WHY THE FIRST TAG WINS
 *
 * A ticket has one owner. When two people are tagged, the first named is the
 * one being asked -- "@Jemie @Ally one of you can pick this up" reads as Jemie
 * first -- and the rest are notified rather than dropped, so nobody tagged goes
 * uninformed. Refusing to choose and falling back to Ally would be worse: it
 * ignores an explicit instruction because it was slightly ambiguous.
 *
 * Pure, so `npm run check:slack` can pin every one of these without a
 * workspace. The route does the lookups; this only decides.
 */

export interface TaggedPerson {
  /** The Slack user id from the message. */
  slackId: string;
  /**
   * Their Hub user id, or null when Slack knows them and the Hub does not --
   * a contractor, a client in a shared channel, somebody who has never logged
   * in. Tagging them is not an error, it just cannot be an assignment.
   */
  hubUserId: string | null;
  name: string | null;
}

export interface AssignmentChoice {
  /** Who owns it. Null only when nothing was tagged and there is no default. */
  assigneeId: string | null;
  name: string | null;
  /** How it was decided, which the Slack reply says out loud. */
  reason: 'tagged' | 'default' | 'nobody';
  /** Tagged people who are not the assignee, to be notified. */
  alsoNotify: string[];
  /**
   * Tagged in Slack but unknown to the Hub. Named in the reply so somebody
   * tagging a colleague who cannot be assigned finds out immediately rather
   * than assuming it worked.
   */
  unknown: string[];
}

export function chooseAssignee(
  tagged: readonly TaggedPerson[],
  fallback: { id: string | null; name: string | null },
): AssignmentChoice {
  const known = tagged.filter((person) => person.hubUserId !== null);

  const unknown = tagged
    .filter((person) => person.hubUserId === null)
    .map((person) => person.name ?? person.slackId);

  if (known.length === 0) {
    return {
      assigneeId: fallback.id,
      name: fallback.name,
      reason: fallback.id === null ? 'nobody' : 'default',
      alsoNotify: [],
      unknown,
    };
  }

  const [first, ...rest] = known;

  return {
    assigneeId: first!.hubUserId,
    name: first!.name,
    reason: 'tagged',
    // Deduplicated, and never the assignee twice.
    alsoNotify: [
      ...new Set(
        rest
          .map((person) => person.hubUserId)
          .filter((id): id is string => id !== null && id !== first!.hubUserId),
      ),
    ],
    unknown,
  };
}
