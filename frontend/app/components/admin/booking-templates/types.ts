export type BookingFormTemplate =
  | 'practitioner-institutional'
  | 'template-2'
  | 'template-3';

export interface BookingTemplateDefinition {
  id: BookingFormTemplate;
  name: string;
  description: string;
  available: boolean;
}

export const DEFAULT_BOOKING_TEMPLATE: BookingFormTemplate =
  'practitioner-institutional';

export const BOOKING_TEMPLATES: BookingTemplateDefinition[] = [
  {
    id: 'practitioner-institutional',
    name: 'Conference registration',
    description: 'Practitioner and institutional details, including whether the attendee is Faculty or a Delegate. Suited to SMRSC and CME programmes.',
    available: true,
  },
  {
    id: 'template-2',
    name: 'Standard registration',
    description: 'Practitioner and institutional details, without the Faculty / Delegate question. Used for MantraM visits.',
    available: true,
  },
  {
    id: 'template-3',
    name: 'Template 3',
    description: 'This registration template will be configured later.',
    available: false,
  },
];

/** The form each kind of event normally uses; admins can still choose another. */
export const DEFAULT_TEMPLATE_FOR_TYPE: Record<'conference' | 'mantram' | 'event' | 'participation', BookingFormTemplate> = {
  conference: 'practitioner-institutional',
  mantram: 'template-2',
  event: 'practitioner-institutional',
  participation: 'practitioner-institutional',
};

export const BOOKING_TEMPLATE_VALUES =
  BOOKING_TEMPLATES.map((template) => template.id);

export function isBookingFormTemplate(
  value: unknown,
): value is BookingFormTemplate {
  return (
    typeof value === 'string' &&
    BOOKING_TEMPLATE_VALUES.includes(
      value as BookingFormTemplate,
    )
  );
}