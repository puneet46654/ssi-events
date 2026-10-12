import Link from 'next/link';

/*
 * Plain text pages (privacy notice, event terms). Both are drafts pending review by
 * SS Innovations regulatory and legal; edit the wording in the page files, not here.
 */

export type LegalSection = { heading: string; paragraphs?: string[]; items?: string[] };

export function LegalPage({ title, updated, intro, sections }: { title: string; updated: string; intro: string; sections: LegalSection[] }) {
  return (
    <main className="mx-auto w-full max-w-[760px] px-4 pb-16 pt-5 md:px-8 md:pt-8">
      <Link href="/" className="text-[13px] font-medium text-primary underline-offset-4 hover:underline">All events</Link>
      <h1 className="mt-2 text-[24px] font-semibold leading-tight tracking-[-0.01em] text-secondary md:text-[30px]">{title}</h1>
      <p className="mt-1 text-[13px] text-gray-500">Last updated {updated}</p>
      <p className="mt-5 text-[14px] leading-[1.7] text-gray-700 md:text-[15px]">{intro}</p>
      {sections.map((section) => (
        <section key={section.heading} className="mt-7">
          <h2 className="text-[16px] font-semibold text-secondary md:text-[17px]">{section.heading}</h2>
          {section.paragraphs?.map((text) => (
            <p key={text} className="mt-2 text-[14px] leading-[1.7] text-gray-700 md:text-[15px]">{text}</p>
          ))}
          {section.items && (
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[14px] leading-[1.65] text-gray-700 md:text-[15px]">
              {section.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          )}
        </section>
      ))}
    </main>
  );
}
