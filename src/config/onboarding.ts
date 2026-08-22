/**
 * The Client Onboarding board.
 *
 * Six columns. Four of them are facts — a form was submitted, or every step is
 * finished — and only two are opinions somebody types in. That asymmetry is
 * deliberate and is why this is not a drag-anywhere kanban: a client sitting in
 * "Kick off form submitted" is there because the form exists, and moving the card
 * by hand would make the board disagree with the filing cabinet.
 *
 * ============================== DO NOT RENAME ==============================
 * These keys are the onboarding_status enum in Postgres.
 * ===========================================================================
 */
export const ONBOARDING_STATUSES = [
  'new_signup',
  'onboarding_form',
  'kickoff_form',
  'waiting_on_team',
  'waiting_on_client',
  'launch_ready',
] as const;

export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export const STATUS_LABELS: Record<OnboardingStatus, string> = {
  new_signup: 'New client sign up',
  onboarding_form: 'Onboarding form submitted',
  kickoff_form: 'Kick off form submitted',
  waiting_on_team: 'Waiting on team',
  waiting_on_client: 'Waiting on client',
  launch_ready: 'Launch ready',
};

export const STATUS_HINTS: Record<OnboardingStatus, string> = {
  new_signup: 'Arrived from the New Client form. Nothing else submitted yet.',
  onboarding_form: 'The practice has completed the onboarding form.',
  kickoff_form: 'A CSM has submitted the kick off form.',
  waiting_on_team: 'Held by hand. Something is outstanding on our side.',
  waiting_on_client: 'Held by hand. Waiting on the practice to send something.',
  launch_ready: 'Every onboarding step is done.',
};

/** The two a person may choose. The rest are consequences, not decisions. */
export const MANUAL_STATUSES: readonly OnboardingStatus[] = [
  'waiting_on_team',
  'waiting_on_client',
];

export function isOnboardingStatus(value: string): value is OnboardingStatus {
  return (ONBOARDING_STATUSES as readonly string[]).includes(value);
}

/**
 * The kick off form, in the onboarding sub-account.
 *
 * Linked rather than embedded: it writes to GoHighLevel, and a copy of it here
 * would be a second form to keep in step with the first.
 */
export const KICKOFF_FORM_URL =
  'https://api.leadconnectorhq.com/widget/form/1SggeGDzW2d72OQ6zYVA';

/** Which forms count as onboarding paperwork, and what to call them. */
export const ONBOARDING_FORM_LABELS: Record<string, string> = {
  'new-client': 'New client sign up',
  'client-onboarding': 'Onboarding form',
  'client-onboarding-legacy': 'Onboarding form (legacy)',
  'kick-off': 'Kick off form',
};
