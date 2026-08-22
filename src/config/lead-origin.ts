/**
 * Where a B2B lead came from.
 *
 * The problem this solves, in Joshua's words: about 10% of the client base
 * refers somebody each month, and he knows that because he asked two people.
 * Referrals and word-of-mouth Google searches are the bulk of new business right
 * now — the ads are switched off until September — and none of it is measured.
 *
 * A referral is invisible to every automatic signal. It has no utm, no ad id,
 * and GoHighLevel's own source field says nothing useful about one. The only
 * record that exists is the tag a human put on the contact, which is why tags
 * are the first thing checked here and the reason this file exists at all.
 *
 * ============================== DO NOT RENAME ==============================
 * The keys are the lead_origin enum in Postgres.
 * ===========================================================================
 */
export const LEAD_ORIGINS = [
  'referral',
  'organic',
  'paid',
  'outbound',
  'unknown',
] as const;

export type LeadOrigin = (typeof LEAD_ORIGINS)[number];

export const ORIGIN_LABELS: Record<LeadOrigin, string> = {
  referral: 'Referral',
  organic: 'Organic',
  paid: 'Paid ads',
  outbound: 'Outbound',
  unknown: 'Not known',
};

export const ORIGIN_HINTS: Record<LeadOrigin, string> = {
  referral: 'Tagged as a referral by whoever took the call.',
  organic: 'Found Apex themselves — usually a search for the company name.',
  paid: 'Carries an ad or campaign id.',
  outbound: 'We approached them.',
  unknown: 'Nothing on the record says either way.',
};

/**
 * Tags that mean a referral.
 *
 * More than the exact word, because a tag is typed by a person under time
 * pressure: "referral", "referred", "Referral - Dr Smith" all mean the same
 * thing and only the first would match an equality test.
 */
const REFERRAL_TAGS = [/\brefer/i];

/** Tags that mean we went to them, rather than them coming to us. */
const OUTBOUND_TAGS = [/\bcold\b/i, /\boutbound\b/i, /\bprospect(ing)?\b/i];

/** Free-text sources that mean they found us. */
const ORGANIC_SOURCES = [
  /\bgoogle\b/i,
  /\borganic\b/i,
  /\bsearch\b/i,
  /\bword of mouth\b/i,
  /\bdirect\b/i,
];

export interface OriginSignals {
  tags: readonly string[];
  /** GoHighLevel's own free-text source field. */
  source: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  campaignId: string | null;
  adId: string | null;
}

/**
 * Classifies a lead, tags first.
 *
 * Order is the argument. A tag is a deliberate human statement and beats every
 * inferred signal — if somebody marked a lead as a referral, it is a referral
 * even when a stray utm followed them around the internet first.
 *
 * Paid comes next, and only on an ad or campaign id rather than on a utm alone:
 * utm_source survives being forwarded in an email, so a referral who clicked a
 * link from the person referring them would otherwise be counted as an ad.
 *
 * Everything unmatched stays 'unknown' rather than being rounded into organic.
 * With the ads off, organic and unknown are the two numbers that decide whether
 * the referral rate is real, and merging them would answer the question by
 * assuming it.
 */
export function classifyOrigin(signals: OriginSignals): LeadOrigin {
  const tags = signals.tags.map((tag) => tag.toLowerCase());

  if (tags.some((tag) => REFERRAL_TAGS.some((pattern) => pattern.test(tag)))) {
    return 'referral';
  }

  if (tags.some((tag) => OUTBOUND_TAGS.some((pattern) => pattern.test(tag)))) {
    return 'outbound';
  }

  if (signals.campaignId || signals.adId) return 'paid';

  const source = signals.source ?? '';
  if (REFERRAL_TAGS.some((pattern) => pattern.test(source))) return 'referral';
  if (ORGANIC_SOURCES.some((pattern) => pattern.test(source))) return 'organic';

  const medium = (signals.utmMedium ?? '').toLowerCase();
  if (medium === 'cpc' || medium === 'paid' || medium === 'ppc') return 'paid';
  if (medium === 'organic' || medium === 'referral') {
    return medium === 'referral' ? 'referral' : 'organic';
  }

  return 'unknown';
}
