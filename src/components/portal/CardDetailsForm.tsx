'use client';

/**
 * Card details, collected by GoHighLevel rather than by us.
 *
 * The fields live inside an iframe on leadconnectorhq.com, so a card number
 * never enters this page's DOM, never reaches our server and never lands in our
 * database. That is the entire point: storing a PAN puts the whole app in PCI
 * scope, and storing a CVV is not permitted at all. Handing the job to a
 * processor that already carries that burden is the only sane version of this
 * feature.
 *
 * Consequently there is nothing to submit, validate or persist here — no
 * onSubmit, no server action, no column. If a future change makes this component
 * read a card value, that change is wrong.
 */
import Script from 'next/script';

/** GoHighLevel's embed script, which resizes the iframe to fit its content. */
const EMBED_SCRIPT = 'https://link.msgsndr.com/js/form_embed.js';

export function CardDetailsForm({
  formId,
  practiceName,
  email,
}: {
  formId: string;
  /**
   * Passed through so the submission is attributable.
   *
   * Without it Apex receives a card with no reliable indication of which
   * practice sent it — the portal knows who is looking, but the iframe does not
   * unless we tell it. Prefill keys have to match the field names on the GHL
   * form; ones that do not match are ignored rather than erroring, so a rename
   * on their side fails quietly and is worth checking after any form edit.
   */
  practiceName: string;
  email?: string | null;
}) {
  const params = new URLSearchParams({ company_name: practiceName });
  if (email) params.set('email', email);

  const src = `https://api.leadconnectorhq.com/widget/form/${formId}?${params.toString()}`;

  return (
    <div>
      <iframe
        src={src}
        id={`inline-${formId}`}
        title="Card Details Update"
        // 434 is the form's own height. The embed script replaces it with the
        // real content height once it loads; this is what shows until then, and
        // what shows if the script is blocked.
        style={{
          width: '100%',
          minHeight: 434,
          border: 'none',
          borderRadius: 8,
        }}
        data-layout="{'id':'INLINE'}"
        data-trigger-type="alwaysShow"
        data-trigger-value=""
        data-activation-type="alwaysActivated"
        data-activation-value=""
        data-deactivation-type="neverDeactivate"
        data-deactivation-value=""
        data-form-name="Card Details Update"
        data-height="434"
        data-layout-iframe-id={`inline-${formId}`}
        data-form-id={formId}
      />

      {/*
        lazyOnload rather than afterInteractive: this is below the fold on the
        account page and must never delay the parts of the portal a client
        actually came for.
      */}
      <Script src={EMBED_SCRIPT} strategy="lazyOnload" />

      <p className="mt-3 text-xs text-fg-subtle">
        Card details are entered directly with our payment provider. They are not
        stored on this site.
      </p>
    </div>
  );
}
