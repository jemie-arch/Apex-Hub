/**
 * The two public forms: Kick-Off and Post Close.
 *
 * Field names are the keys stored in form_submissions.payload, so they are as
 * stable as a permission key — renaming one orphans every answer already
 * collected under the old name. Labels are free to change.
 *
 * The form_key values ('kick_off', 'post_close') are what the Forms page and
 * any downstream automation match on, and must not change either.
 */
export interface PublicFormField {
  name: string;
  label: string;
  hint?: string;
  type?: 'text' | 'email' | 'tel' | 'date' | 'long';
  required?: boolean;
}

export interface PublicFormDefinition {
  /** URL segment: /f/<slug>. */
  slug: string;
  /** Stored in form_submissions.form_key. NEVER rename. */
  key: string;
  title: string;
  intro: string;
  sections: Array<{ heading: string; fields: PublicFormField[] }>;
  /** Shown after a successful submission. */
  thanks: string;
}

export const PUBLIC_FORMS: readonly PublicFormDefinition[] = [
  {
    slug: 'post-close',
    key: 'post_close',
    title: 'Welcome — a few details to get started',
    intro:
      'This is everything we need to open your account and book your kick-off ' +
      'call. It takes about five minutes, and you can send it before you have ' +
      'every answer.',
    sections: [
      {
        heading: 'The practice',
        fields: [
          {
            name: 'practice_name',
            label: 'Practice name',
            required: true,
          },
          { name: 'website', label: 'Website' },
          { name: 'address', label: 'Address', type: 'long' },
          { name: 'phone', label: 'Main phone', type: 'tel' },
        ],
      },
      {
        heading: 'Who we work with',
        fields: [
          { name: 'contact_name', label: 'Main contact', required: true },
          {
            name: 'email',
            label: 'Email',
            type: 'email',
            required: true,
            hint: 'Where reports and consultation notifications go.',
          },
          { name: 'contact_role', label: 'Their role' },
          {
            name: 'billing_email',
            label: 'Billing email',
            hint: 'Leave blank if it is the same as above.',
          },
        ],
      },
      {
        heading: 'Getting going',
        fields: [
          {
            name: 'preferred_start',
            label: 'When you would like to launch',
            type: 'date',
          },
          {
            name: 'treatments',
            label: 'Treatments to advertise',
            type: 'long',
            hint: 'Braces, Invisalign, implants — what you want more of.',
          },
          {
            name: 'anything_else',
            label: 'Anything we should know first',
            type: 'long',
          },
        ],
      },
    ],
    thanks:
      'Got it. Your onboarding manager will be in touch to book the kick-off ' +
      'call, usually the same working day.',
  },
  {
    slug: 'kick-off',
    key: 'kick_off',
    title: 'Kick-off details',
    intro:
      'The answers here decide what we advertise, how patients get booked, and ' +
      'what your ads say. The more specific you are, the less guessing we do.',
    sections: [
      {
        heading: 'The practice',
        fields: [
          { name: 'practice_name', label: 'Practice name', required: true },
          {
            name: 'email',
            label: 'Your email',
            type: 'email',
            required: true,
          },
        ],
      },
      {
        heading: 'What you want more of',
        fields: [
          {
            name: 'target_treatments',
            label: 'Treatments to push',
            type: 'long',
            required: true,
          },
          {
            name: 'average_case_value',
            label: 'Typical case value',
            hint: 'Roughly what a full plan is worth. It tells us what a lead is worth.',
          },
          {
            name: 'financing_offered',
            label: 'Financing you offer',
            type: 'long',
          },
          {
            name: 'not_wanted',
            label: 'Cases you would rather not see',
            type: 'long',
            hint: 'Cheaper to say now than to filter out later.',
          },
        ],
      },
      {
        heading: 'Booking patients in',
        fields: [
          {
            name: 'consult_availability',
            label: 'When you can see new consultations',
            type: 'long',
            required: true,
          },
          { name: 'consult_length', label: 'How long a new-patient consult takes' },
          { name: 'who_answers', label: 'Who answers the phone, and when' },
          {
            name: 'existing_offers',
            label: 'Offers we may advertise',
            type: 'long',
            hint: 'Free consult, free scan, a discount — worded as you want it seen.',
          },
        ],
      },
      {
        heading: 'Content',
        fields: [
          {
            name: 'content_available',
            label: 'Footage and photos you already have',
            type: 'long',
          },
          {
            name: 'brand_notes',
            label: 'How you want to come across',
            type: 'long',
          },
        ],
      },
    ],
    thanks:
      'Thank you — this is what we build the campaigns from. If anything ' +
      'changes, send the form again; the latest answers are the ones we use.',
  },
];

export function findPublicForm(slug: string): PublicFormDefinition | null {
  return PUBLIC_FORMS.find((form) => form.slug === slug) ?? null;
}
