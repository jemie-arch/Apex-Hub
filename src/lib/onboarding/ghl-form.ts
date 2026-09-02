/**
 * Reading a GoHighLevel onboarding submission as provisioning answers.
 *
 * There are two onboarding intakes and both have to work. The Hub hosts its own
 * form at /f/client_onboarding, whose fields are already the snake_case names
 * ONBOARDING_VALUE_MAP expects, so it provisions on submit with nothing in
 * between. The other is the GoHighLevel form, whose payload keys are the
 * question text a human typed into the form builder — full sentences, including
 * one with a trailing space.
 *
 * That difference is the entire reason 141 real submissions never provisioned
 * while the automation sat there working: the machine only ever recognised the
 * snake_case shape. This translates the other one.
 *
 * Deliberately additive. The original payload is returned untouched alongside
 * the derived keys, so nothing is lost, a GoHighLevel form that later adds a
 * snake_case field needs no change here, and a key this file does not know about
 * still reaches valuesFor() under its own name.
 */
import type { Answers } from '@/lib/onboarding/provision';

/**
 * GoHighLevel question text -> the field name provisioning reads.
 *
 * Written out in full rather than matched loosely. These are the exact keys as
 * stored, checked against the live submissions: "Timezone -" carries no trailing
 * space, and the questions below are reproduced character for character. A near
 * miss here does not raise an error, it silently maps nothing — which is the
 * failure this file exists to correct, so it should not be reintroduced by a
 * hand-typed approximation.
 */
export const GHL_ONBOARDING_FIELDS: Readonly<Record<string, string>> = {
  'Clinic Friendly Name': 'clinic_name',
  'Timezone -': 'timezone',
  'Are there any landmarks near your clinic we can use as a reference point when we direct people to their appointments?':
    'landmark',
  'Name or Names of Front Desk Patient Concierge': 'front_desk_name',
  "Does your practice offer consultations in any other languages? We'll send these patients directly through to your office.":
    'languages',
  'We can collect these information points to expedite the consultation process. Please select the information points you would like us to collect.':
    'requirements',
  email: 'doctor_email',
  phone: 'doctor_phone',
};

/** The one question that answers two fields. */
const DOCTOR_FIELD =
  'What is the name and gender of the doctor/doctors providing treatment?';

/**
 * Gender words this will accept as a stated answer.
 *
 * Only an explicit statement counts. A doctor's gender is never inferred from
 * their name — a guess written into a custom value becomes the merge field that
 * addresses a real person wrongly in every message the practice sends, and the
 * snapshot's own default is better than a confident mistake. If the practice did
 * not say, the field stays unset.
 */
const STATED_GENDER: Readonly<Record<string, string>> = {
  m: 'Male',
  male: 'Male',
  man: 'Male',
  f: 'Female',
  female: 'Female',
  woman: 'Female',
  nb: 'Non-binary',
  nonbinary: 'Non-binary',
  'non-binary': 'Non-binary',
};

function text(value: unknown): string | undefined {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Split "Dr Jane Smith, female" into a name and a stated gender.
 *
 * The form asks for both in one free-text box, so the answer arrives however
 * the practice chose to write it. Only a trailing separated fragment is
 * considered, and only when it is a word from the list above; anything else is
 * left as part of the name. "Dr Alex Chen" yields a name and no gender, which
 * is the correct outcome — not a guess.
 */
export function splitDoctor(answer: string): {
  name?: string;
  gender?: string;
} {
  /*
   * A hyphen only separates when it is spaced.
   *
   * Splitting on any hyphen tore "non-binary" into "non" and "binary", so a
   * stated answer read as no answer — and it would have cut "Ruiz-Marquez" in
   * half on the way to the same wrong result. Commas, semicolons and brackets
   * are unambiguous; a bare hyphen inside a word is part of the word.
   */
  const parts = answer.split(/\s*[,;(]\s*|\s+[–—-]\s+|\s+\/\s+/);
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  if (last !== undefined) {
    const tail = last.replace(/[).]+$/, '').trim();
    const gender = STATED_GENDER[tail.toLowerCase()];
    if (gender) {
      const name = parts.slice(0, -1).join(' ').trim();
      return { name: name === '' ? undefined : name, gender };
    }
  }
  const name = answer.trim();
  return { name: name === '' ? undefined : name };
}

/**
 * Translate a GoHighLevel onboarding payload into provisioning answers.
 *
 * Existing snake_case keys always win over a derived one: if a payload somehow
 * carries both, the explicit field is the one somebody meant.
 */
export function adaptGhlOnboarding(
  payload: Record<string, unknown>,
): Answers {
  const answers: Answers = {};

  for (const [key, value] of Object.entries(payload)) {
    const asText = text(value);
    if (asText !== undefined) answers[key] = asText;
  }

  for (const [question, field] of Object.entries(GHL_ONBOARDING_FIELDS)) {
    if (answers[field] !== undefined) continue;
    const answer = text(payload[question]);
    if (answer !== undefined) answers[field] = answer;
  }

  const doctor = text(payload[DOCTOR_FIELD]);
  if (doctor !== undefined) {
    const { name, gender } = splitDoctor(doctor);
    if (name !== undefined && answers['doctor_name'] === undefined) {
      answers['doctor_name'] = name;
    }
    if (gender !== undefined && answers['doctor_gender'] === undefined) {
      answers['doctor_gender'] = gender;
    }
  }

  /*
   * The GoHighLevel form labels the practice "organization" and only sometimes
   * asks for a friendlier name. Provisioning needs something to call the
   * sub-account, so the friendly name wins and this is the backstop.
   */
  if (answers['clinic_name'] === undefined) {
    const organization = text(payload['organization']);
    if (organization !== undefined) answers['clinic_name'] = organization;
  }

  return answers;
}

/** Form keys this adapter understands. The Hub's own form needs no translation. */
export const GHL_ONBOARDING_FORM_KEY = 'client-onboarding';
export const HUB_ONBOARDING_FORM_KEY = 'client_onboarding';
