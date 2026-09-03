/**
 * Is this message actually asking tech for something?
 *
 * THE PROBLEM
 *
 * The bot files a ticket for every mention, and not every mention is a request.
 * The one that forced this was an announcement *about* the bot:
 *
 *   "for any tech support, please tag @Apex. if you need a task specifically
 *    done, tag me or ally. or else it will automatically gona assign ally."
 *
 * A ticket, filed, assigned to Ally, for a message explaining how to file
 * tickets. Nothing rule-based separates that from a real request without also
 * breaking real requests — it contains "tech support", "task" and "assign".
 *
 * WHY THIS CANNOT SIMPLY REFUSE
 *
 * The two failure modes are not symmetric. Filing noise costs somebody a minute
 * closing a ticket. Declining a real request loses work that nobody knows is
 * missing — the person who asked believes it was filed, and the tech team never
 * heard it. That is the failure this codebase refuses everywhere else: the
 * consultation webhook will not turn a blank answer into a no-show, and the
 * mention parser will not turn a bare @apex into "(no description)".
 *
 * So three rules hold here, and they are all about which way to be wrong:
 *
 *   1. FAIL OPEN. No API key, a timeout, a malformed response, a rate limit —
 *      every failure files the ticket. An outage at Anthropic must never become
 *      silent data loss at Apex.
 *   2. BIAS TOWARD FILING. The prompt says so explicitly. When it is arguable,
 *      it files.
 *   3. NEVER SILENT. A decline is always announced in the thread, and the route
 *      records the message so a 🎫 reaction can promote it to a ticket after
 *      the fact. "I did not file this" is information; saying nothing is not.
 *
 * Structured outputs rather than parsing prose, so a chatty response cannot be
 * mistaken for a verdict.
 */
import Anthropic from '@anthropic-ai/sdk';

import { serverEnv } from '@/lib/env';

export interface Verdict {
  /** Whether to file a ticket. */
  file: boolean;
  /** One short clause, shown in the thread when it declines. */
  reason: string;
  /** How the verdict was reached, for the response body and the logs. */
  decidedBy: 'model' | 'not-configured' | 'error';
}

/** Always files. The shape every failure path returns. */
function fileAnyway(decidedBy: Verdict['decidedBy'], reason: string): Verdict {
  return { file: true, reason, decidedBy };
}

const SYSTEM = `You decide whether a Slack message is asking the tech team to do something.

You are triaging messages that mention a bot called @apex in a dental marketing
agency's Slack. The agency runs client websites, ad accounts, CRM automations
and phone systems, so genuine requests are usually about something broken or
something needing setting up.

File a ticket when the message asks for work: a report of something broken, a
request to change or check or set up something, a question that needs somebody
to go and look.

Do NOT file when the message is not a request at all. The clearest cases:
- an announcement or instruction ABOUT the bot itself, explaining how or when
  to tag it
- somebody testing the bot, or talking about how it behaves
- thanks, acknowledgement, chat, or a comment on a request already made
- a status update reporting that something is already done

When it is arguable, FILE IT. A ticket nobody needed costs a minute to close.
A request you declined is work nobody knows was asked for, and that is far
worse. Only decline when you are confident the message asks for nothing.`;

/**
 * Ask the model. Never throws.
 *
 * `raiserName` and `channelName` go in because they change the reading: the
 * same words in #tech-team from a media buyer and in #general from the person
 * who set the bot up are not the same message.
 */
export async function looksLikeARequest(input: {
  text: string;
  raiserName?: string | null;
  channelName?: string | null;
}): Promise<Verdict> {
  const text = input.text.trim();
  if (text === '') return fileAnyway('not-configured', 'nothing to classify');

  let apiKey: string | undefined;
  try {
    apiKey = serverEnv().ANTHROPIC_API_KEY;
  } catch {
    return fileAnyway('not-configured', 'environment unreadable');
  }

  /*
   * No key means no classifier, which means the bot behaves exactly as it did
   * before this file existed. That is the correct degraded state: filing
   * everything is the behaviour somebody already found useful.
   */
  if (!apiKey) return fileAnyway('not-configured', 'ANTHROPIC_API_KEY is not set');

  const client = new Anthropic({ apiKey });

  const context = [
    input.channelName ? `Channel: #${input.channelName}` : null,
    input.raiserName ? `From: ${input.raiserName}` : null,
    '',
    'Message:',
    text,
  ]
    .filter((line) => line !== null)
    .join('\n');

  try {
    const response = await client.messages.create(
      {
        model: serverEnv().SLACK_CLASSIFIER_MODEL,
        max_tokens: 256,
        /*
         * Low effort deliberately. This is a two-way classification on a few
         * sentences, and Slack gives the endpoint three seconds before it
         * starts retrying — a long think here buys nothing and costs the
         * budget the ticket insert still needs.
         */
        output_config: {
          effort: 'low',
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                file: {
                  type: 'boolean',
                  description: 'true if this message asks the tech team to do something',
                },
                reason: {
                  type: 'string',
                  description:
                    'One short clause, at most 12 words, saying how you read the message. Written to be shown to the person who sent it.',
                },
              },
              required: ['file', 'reason'],
              additionalProperties: false,
            },
          },
        },
        system: SYSTEM,
        messages: [{ role: 'user', content: context }],
      },
      // Well inside Slack's three seconds, and the caller files anyway on a
      // timeout — so a slow model degrades to the old behaviour rather than to
      // a retry storm.
      { timeout: 2_500, maxRetries: 0 },
    );

    const block = response.content.find((part) => part.type === 'text');
    if (!block || block.type !== 'text') {
      return fileAnyway('error', 'classifier returned no text');
    }

    const parsed = JSON.parse(block.text) as { file?: unknown; reason?: unknown };

    // Anything other than an explicit false files it. A missing or malformed
    // `file` field is not a decline.
    if (parsed.file === false) {
      return {
        file: false,
        reason:
          typeof parsed.reason === 'string' && parsed.reason.trim() !== ''
            ? parsed.reason.trim()
            : 'read as a message rather than a request',
        decidedBy: 'model',
      };
    }

    return {
      file: true,
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'read as a request',
      decidedBy: 'model',
    };
  } catch (error) {
    /*
     * Logged loudly and filed anyway. If this line appears in the logs every
     * time, the classifier is dead and the bot has quietly reverted to filing
     * everything — noisy, but nothing is being lost.
     */
    console.error(
      '[slack] classifier failed, filing the ticket anyway:',
      error instanceof Error ? error.message : error,
    );
    return fileAnyway('error', 'classifier unavailable');
  }
}
