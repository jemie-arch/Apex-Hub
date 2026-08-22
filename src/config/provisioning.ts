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
export const UNAVAILABLE_CUSTOM_VALUES: ReadonlyArray<{
  brief: string;
  note: string;
}> = [
  {
    brief: 'Doctor Gender',
    note:
      'No custom value of this name exists in the snapshot. The form still ' +
      'collects it, so it is on the submission and can be written the moment ' +
      'the field is added.',
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
