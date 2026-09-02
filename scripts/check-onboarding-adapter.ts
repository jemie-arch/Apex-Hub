/**
 * Exercise the GoHighLevel onboarding adapter against the real payload shape.
 *
 * This exists because the failure it guards against is silent. A question key
 * that is one character off does not throw — it maps nothing, the custom value
 * is never written, and provisioning reports success having filled in less than
 * it should. That is the exact shape of the original bug: the automation worked
 * and simply never saw 141 submissions.
 *
 * The keys below are copied from live submissions, including the trailing space
 * on the "top 3 challenges" question, which is theirs and not a typo here. No
 * practice data: clinic names, doctors and contact details are invented.
 *
 *   npm run check:onboarding
 *
 * No database, no network, no secret. Exits non-zero on the first failure.
 */
import {
  adaptGhlOnboarding,
  GHL_ONBOARDING_FIELDS,
  splitDoctor,
} from '../src/lib/onboarding/ghl-form';
import {
  KNOWN_ABSENT_CUSTOM_VALUES,
  ONBOARDING_VALUE_MAP,
  UNAVAILABLE_CUSTOM_VALUES,
} from '../src/config/provisioning';
import { splitName } from '../src/lib/integrations/ghl-provision';

let failures = 0;
let checks = 0;

function check(what: string, actual: unknown, expected: unknown) {
  checks += 1;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    console.log(`  ok    ${what}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${what}`);
  console.log(`        expected ${b}`);
  console.log(`        actual   ${a}`);
}

function section(title: string) {
  console.log(`\n${title}`);
}

/** A payload shaped exactly like the live GoHighLevel onboarding form. */
const ghlPayload: Record<string, unknown> = {
  'Clinic Friendly Name': '  Riverbend Dental  ',
  organization: 'Riverbend Dental Group LLC',
  'Timezone -': 'America/Chicago',
  'Are there any landmarks near your clinic we can use as a reference point when we direct people to their appointments?':
    'Opposite the blue water tower',
  'Name or Names of Front Desk Patient Concierge': 'Robin and Alex',
  "Does your practice offer consultations in any other languages? We'll send these patients directly through to your office.":
    'Spanish',
  'We can collect these information points to expedite the consultation process. Please select the information points you would like us to collect.':
    'Insurance provider, Preferred time',
  'What is the name and gender of the doctor/doctors providing treatment?':
    'Dr Morgan Reyes, female',
  email: 'front.desk@example.invalid',
  phone: '+1 555 0100',
  'What are the top 3 challenges in your business that if solved, would make your investment into our program worth it? ':
    'Chair time, no-shows, case acceptance',
  website: 'https://example.invalid',
  city: 'Springfield',
};

// ---------------------------------------------------------------------------
section('Every question key maps to a field provisioning actually reads');
{
  const known = new Set(Object.keys(ONBOARDING_VALUE_MAP));
  // clinic_name is consumed by name handling rather than the value map.
  known.add('clinic_name');

  for (const [question, field] of Object.entries(GHL_ONBOARDING_FIELDS)) {
    check(`${field} is a real target (${question.slice(0, 34)}…)`, known.has(field), true);
  }
}

section('The live GoHighLevel shape translates');
{
  const answers = adaptGhlOnboarding(ghlPayload);
  check('clinic name, trimmed', answers['clinic_name'], 'Riverbend Dental');
  check('timezone', answers['timezone'], 'America/Chicago');
  check('landmark', answers['landmark'], 'Opposite the blue water tower');
  check('front desk', answers['front_desk_name'], 'Robin and Alex');
  check('languages', answers['languages'], 'Spanish');
  check('requirements', answers['requirements'], 'Insurance provider, Preferred time');
  check('doctor email', answers['doctor_email'], 'front.desk@example.invalid');
  check('doctor phone', answers['doctor_phone'], '+1 555 0100');
  check('doctor name, gender stripped', answers['doctor_name'], 'Dr Morgan Reyes');
  check('stated gender', answers['doctor_gender'], 'Female');
  check('unmapped answers survive', answers['city'], 'Springfield');
}

section('The friendly name wins, and organization is only a backstop');
{
  const withoutFriendly = { ...ghlPayload };
  delete withoutFriendly['Clinic Friendly Name'];
  const answers = adaptGhlOnboarding(withoutFriendly);
  check('falls back to organization', answers['clinic_name'], 'Riverbend Dental Group LLC');
}

section('Gender is read, never inferred');
{
  check('stated after a comma', splitDoctor('Dr Jane Ali, Female'), {
    name: 'Dr Jane Ali',
    gender: 'Female',
  });
  check('stated in parentheses', splitDoctor('Dr Sam Okafor (M)'), {
    name: 'Dr Sam Okafor',
    gender: 'Male',
  });
  check('non-binary is a stated answer', splitDoctor('Dr Rae Lin - non-binary'), {
    name: 'Dr Rae Lin',
    gender: 'Non-binary',
  });
  // The important one: a name alone must never produce a gender.
  check('no claim from a name alone', splitDoctor('Dr Jane Ali'), {
    name: 'Dr Jane Ali',
  });
  // A hyphen inside a word is part of the word, not a separator.
  check('hyphenated surname survives intact', splitDoctor('Dr Ana Ruiz-Marquez'), {
    name: 'Dr Ana Ruiz-Marquez',
  });
  check('two doctors, no gender claimed', splitDoctor('Dr Lee and Dr Osei'), {
    name: 'Dr Lee and Dr Osei',
  });
}

section('Silence stays silent');
{
  const answers = adaptGhlOnboarding({
    'Clinic Friendly Name': 'Only A Name',
    'Timezone -': '   ',
    email: '',
  });
  check('blank timezone is absent', 'timezone' in answers, false);
  check('blank email is absent', 'doctor_email' in answers, false);
  check('no doctor invented', 'doctor_name' in answers, false);
  check('no gender invented', 'doctor_gender' in answers, false);
  check('the name still arrives', answers['clinic_name'], 'Only A Name');
}

section('An explicit snake_case field always beats a derived one');
{
  const answers = adaptGhlOnboarding({
    'Clinic Friendly Name': 'Derived Name',
    clinic_name: 'Explicit Name',
    email: 'derived@example.invalid',
    doctor_email: 'explicit@example.invalid',
  });
  check('explicit clinic name wins', answers['clinic_name'], 'Explicit Name');
  check('explicit doctor email wins', answers['doctor_email'], 'explicit@example.invalid');
}

section('Splitting a doctor name for the GoHighLevel user endpoint');
{
  check('title is not a first name', splitName('Dr Morgan Reyes'), {
    firstName: 'Morgan',
    lastName: 'Reyes',
  });
  check('title with a full stop', splitName('Dr. Morgan Reyes'), {
    firstName: 'Morgan',
    lastName: 'Reyes',
  });
  // Everything after the first word is the surname, so compound names survive.
  check('compound surname stays whole', splitName('Dr Ana van der Berg'), {
    firstName: 'Ana',
    lastName: 'van der Berg',
  });
  check('hyphenated surname stays whole', splitName('Ana Ruiz-Marquez'), {
    firstName: 'Ana',
    lastName: 'Ruiz-Marquez',
  });
  // A single name must not be duplicated into both fields — nobody should be
  // greeted as "Osei Osei".
  check('one word leaves the surname empty', splitName('Osei'), {
    firstName: 'Osei',
    lastName: '',
  });
  check('a bare title is kept rather than emptied', splitName('Dr'), {
    firstName: 'Dr',
    lastName: '',
  });
  check('extra whitespace is harmless', splitName('  Dr   Sam   Okafor  '), {
    firstName: 'Sam',
    lastName: 'Okafor',
  });
}

section('A known-absent snapshot field does not make a good run look partial');
{
  // The first real onboarding wrote nine values and reported 'partial' because
  // Timezone alone had nowhere to land. Every successful run would have said
  // partial from then on, which is how a status stops meaning anything.
  check('Timezone is recorded as known-absent', KNOWN_ABSENT_CUSTOM_VALUES.has('Timezone'), true);
  check(
    'and is still mapped, so it fills itself once the snapshot has the field',
    ONBOARDING_VALUE_MAP['timezone'],
    'Timezone',
  );
  check(
    'the absent set is derived from the documented list, not a second copy',
    KNOWN_ABSENT_CUSTOM_VALUES.size,
    UNAVAILABLE_CUSTOM_VALUES.length,
  );

  // The guard must stay narrow: an undocumented gap is still a real surprise.
  const missing = ['Timezone', 'Some Field Nobody Documented'];
  const unexpected = missing.filter((name) => !KNOWN_ABSENT_CUSTOM_VALUES.has(name));
  check('an undocumented gap still counts', unexpected, ['Some Field Nobody Documented']);
  check(
    'a run missing only known-absent fields is clean',
    ['Timezone'].filter((n) => !KNOWN_ABSENT_CUSTOM_VALUES.has(n)).length,
    0,
  );
}

// ---------------------------------------------------------------------------
console.log(
  `\n${checks - failures}/${checks} checks passed` +
    (failures ? ` — ${failures} FAILED` : ''),
);
process.exit(failures ? 1 : 0);
