import { useEffect, useState } from "react";

import { Icon, Icons } from "@/components/Icon";

/*
 * Support links.
 *
 * Each option is its own Stripe payment link, so nothing here touches card
 * details or needs a key on our side - the button only opens Stripe.
 */
const DONATE_OPTIONS = [
  { label: "$5", href: "https://buy.stripe.com/dRmfZheLL83HfNP6tWaMU03" },
  { label: "$10", href: "https://buy.stripe.com/7sY14n8nndo1bxzf0saMU04" },
  { label: "$15", href: "https://buy.stripe.com/3cIaEXeLL4RvcBD5pSaMU05" },
];
const CUSTOM_DONATION = "https://buy.stripe.com/3cI6oHeLLes5313bOgaMU06";

export function DonateButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        title="Support Flux Movies"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-full bg-pill-background bg-opacity-50 px-3 py-1.5 text-sm text-white backdrop-blur-lg transition-[background,transform] duration-100 hover:scale-105 hover:bg-pill-backgroundHover tabbable"
      >
        <Icon icon={Icons.COINS} className="text-base" />
        <span className="hidden sm:inline">Donate</span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Support Flux Movies"
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-largeCard-background p-6 text-white shadow-[0_30px_90px_rgba(0,0,0,0.7)] sm:p-8"
          >
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="absolute right-4 top-4 text-type-dimmed transition-colors hover:text-white"
            >
              <Icon icon={Icons.X} />
            </button>

            <img src="/flux-mark.webp" alt="" className="h-10 w-10" />
            <h2 className="mt-4 text-2xl font-bold tracking-tight">
              Support Flux Movies
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-type-secondary">
              Flux runs on servers someone has to pay for. If it is worth
              something to you, this keeps it online.
            </p>

            <div className="mt-6 grid grid-cols-3 gap-3">
              {DONATE_OPTIONS.map((option) => (
                <a
                  key={option.label}
                  href={option.href}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full bg-white py-2.5 text-center text-sm font-semibold text-black transition-colors duration-200 hover:bg-white/90"
                >
                  {option.label}
                </a>
              ))}
            </div>
            <a
              href={CUSTOM_DONATION}
              target="_blank"
              rel="noreferrer"
              className="mt-3 block rounded-full bg-white/10 py-2.5 text-center text-sm font-semibold text-white ring-1 ring-white/15 transition-colors duration-200 hover:bg-white/20"
            >
              Choose your own amount
            </a>

            <p className="mt-5 text-center text-xs text-type-dimmed">
              Payments are handled by Stripe. Flux never sees your card.
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
