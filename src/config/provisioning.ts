/**
 * What a new sub-account gets, and where each value comes from.
 *
 * ================= THE NAMES ON THE RIGHT ARE NOT LABELS =================
 * They are the custom value names inside GoHighLevel, read off a live
 * snapshot-provisioned sub-account rather than typed from the brief. Several
 * differ from what the brief called them, and a mismatch does not fail loudly —
 * setCustomValues reports the name as missing and the field stays empty:
 *
 *   brief said                       GoHighLevel actually has
 *   Front desk email                 Front Desk Email
 *   Landmark 1                       Landmark1          (no space)
 *   Minimum ages for treatment       Minimum ages for treatments  (plural)
 *   HP Ortho template                HP Ortho Template
 *   Call center manager email        Call Center Manager Email
 *
 * Two from the brief have no custom value at all in that sub-account, so they
 * cannot be written and are listed in UNAVAILABLE below rather than quietly
 * dropped.
 * ========================================================================
 */

/** The snapshot every new practice is built from. */
export const ONBOARDING_SNAPSHOT_ID = 'GJMQAyuLJeSNb7TqDYgj';

/** Same for every practice. */
export const CONSTANT_CUSTOM_VALUES: Record<string, string> = {
  'Call Center Manager Email': 'joshua@redlinedigital.ca',
  CTA: 'free consult',
  'HP Ortho Template':
    'https://miro.com/app/board/uXjVIq9W_es=/?share_link_id=652473701849',
};

/**
 * Form field -> custom value name, for the onboarding form only.
 *
 * The kick-off fields are deliberately absent: they are collected later, by a
 * CSM, and writing them now would mean writing blanks over a snapshot's
 * defaults.
 */
export const ONBOARDING_VALUE_MAP: Record<string, string> = {
  doctor_name: 'Doctor Name',
  doctor_email: 'Doctor Email',
  doctor_gender: 'Doctor Gender',
  doctor_phone: 'Doctor Phone',
  doctor_type: 'Doctor Type',
  confirmations_email: '*Email To Send Confirmations To',
  confirmations_phone: '*Phone Number To Send Confirmations To',
  front_desk_name: 'Front Desk Name',
  front_desk_email: 'Front Desk Email',
  landmark: 'Landmark1',
  languages: 'Language',
  minimum_ages: 'Minimum ages for treatments',
  requirements: 'Requirements',
  timezone: 'Timezone',
};

/**
 * Asked for in the brief, absent from the sub-account we inspected.
 *
 * Kept here rather than dropped so the gap is visible on the provisioning
 * report instead of being discovered months later as an empty merge field. If
 * these get added to the snapshot, move them into the map above and they start
 * being written with no other change.
 */
/**
 * Values the snapshot marks as needing one per client, that no form answer can
 * supply.
 *
 * The snapshot prefixes these with an asterisk, which is whoever built it saying
 * "set this per client". Five carried that mark. Two of them a practice can
 * answer, so the onboarding form now asks and they are mapped. The three below
 * cannot come from a practice, and they cannot be inferred from how existing
 * clients are set up either: a live sub-account was read directly, and it does
 * not have these fields at all. They arrived with a newer snapshot, so there is
 * no precedent anywhere to copy.
 *
 * Listed rather than guessed. A wrong Slack id or stats sheet points automation
 * at somebody else's client, which is worse than an empty field somebody can
 * see is empty.
 */
export const SETUP_ONLY_CUSTOM_VALUES: ReadonlyArray<{
  name: string;
  key: string;
  note: string;
}> = [
  {
    name: '*Slack ID',
    key: 'slack_id',
    note:
      'Per client, and Apex-side: the channel or member id notifications post ' +
      'to. Live accounts carry a different field instead — "Slack New Appt. ' +
      'Notification Webhook", also empty — so it is worth settling which of the ' +
      'two the automation actually reads before either is filled.',
  },
  {
    name: '*Client Stats Sheet URL',
    key: 'medi_stats_sheet_url',
    note:
      'Per client. Apex creates the sheet, so it cannot be asked for on the ' +
      'form — it has to be written back once the sheet exists.',
  },
  {
    name: '*Appointment Status Form',
    key: 'appointment_status_form',
    note:
      'Unclear whether this is one form shared by every client or one each. If ' +
      'it is shared it belongs in CONSTANT_CUSTOM_VALUES and is filled for ' +
      'everybody in one line; if it is per client it needs the same treatment as ' +
      'the stats sheet.',
  },
];
export const UNAVAILABLE_CUSTOM_VALUES: ReadonlyArray<{
  brief: string;
  note: string;
}> = [
  {
    brief: 'Doctor Gender',
    note:
      'Absent from the snapshot, but live sub-accounts do have it — Abraham ' +
      'Orthodontics carries doctor_gender, empty. So the snapshot is behind the ' +
      'accounts built from earlier ones rather than the field being wrong. It is ' +
      'mapped, and lands wherever it exists.',
  },
  {
    brief: 'Legal Business Name',
    note:
      'Not present either. The nearest are "Practice Name" and ' +
      '"[Landing Pages] Business Name" — say which is meant and it will be ' +
      'filled from the clinic name.',
  },
];

/**
 * Values that can only be known after the sub-account exists.
 *
 * Account Link is the agency URL for the new location, so it cannot be part of
 * the create call — it is written on a second pass once the id is known.
 */
export function derivedCustomValues(locationId: string): Record<string, string> {
  return {
    'Account Link': `https://app.gohighlevel.com/v2/location/${locationId}`,
  };
}

/**
 * Set from the practice's own name.
 *
 * Location Name is written; Legal Business Name is not, because it does not
 * exist — see UNAVAILABLE_CUSTOM_VALUES.
 */
export function nameCustomValues(clinicName: string): Record<string, string> {
  return {
    'Location Name': clinicName,
    'Practice Name': clinicName,
  };
}
