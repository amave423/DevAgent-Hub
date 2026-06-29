import { useState } from "react";
import { Info, X } from "lucide-react";
import type { PageInfoContent } from "../i18n/pageInfo";

export function PageInfoButton({ content, label }: { content: PageInfoContent; label: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="icon-button page-info-trigger" type="button" title={label} onClick={() => setOpen(true)}>
        <Info size={17} />
      </button>
      {open && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <aside className="page-info-modal" role="dialog" aria-modal="true" aria-label={content.title} onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>{content.title}</h2>
                <p>{content.intro}</p>
              </div>
              <button className="icon-button" type="button" title="Close" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </header>
            <div className="page-info-content">
              {content.sections.map((section) => (
                <section key={section.title}>
                  <h3>{section.title}</h3>
                  <ul>
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
