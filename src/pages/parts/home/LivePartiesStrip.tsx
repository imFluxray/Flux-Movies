import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  PartySummary,
  listPublicParties,
  partyLink,
} from "@/backend/party/api";
import { Icon, Icons } from "@/components/Icon";

/*
 * Live parties, on the way past.
 *
 * A row nobody has to go looking for: it only appears while rooms are open,
 * so the home page is unchanged the rest of the time.
 */
const POLL_MS = 45000;

export function LivePartiesStrip() {
  const navigate = useNavigate();
  const [parties, setParties] = useState<PartySummary[]>([]);

  useEffect(() => {
    let alive = true;
    const check = () => {
      listPublicParties()
        .then((rooms) => {
          if (alive) setParties(rooms.slice(0, 6));
        })
        .catch(() => {});
    };
    check();
    const timer = window.setInterval(check, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  if (!parties.length) return null;

  return (
    <section className="mt-10" aria-labelledby="live-parties-heading">
      <div className="mb-3 flex items-center justify-between gap-4 px-2 sm:px-0">
        <h2
          id="live-parties-heading"
          className="flex items-center gap-2 text-lg font-bold text-white sm:text-xl"
        >
          <span className="flex items-center gap-1.5 rounded-full bg-[#FF2A32] px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            Live
          </span>
          Watch parties
        </h2>
        <button
          type="button"
          onClick={() => navigate("/parties")}
          className="text-sm text-type-dimmed transition-colors hover:text-white"
        >
          See all
        </button>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {parties.map((party) => (
          <button
            key={party.code}
            type="button"
            onClick={() => navigate(partyLink(party.media, party.code))}
            className="group flex w-64 shrink-0 items-center gap-3 rounded-xl bg-largeCard-background p-2.5 text-left ring-1 ring-white/10 transition-colors duration-200 hover:ring-white/30 tabbable"
          >
            <span className="h-16 w-11 shrink-0 overflow-hidden rounded-lg bg-mediaCard-hoverBackground">
              {party.poster ? (
                <img
                  src={party.poster}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-white">
                {party.title}
              </span>
              <span className="block truncate text-xs text-type-dimmed">
                {party.episodeLabel ? `${party.episodeLabel} · ` : ""}
                {party.hostName}
              </span>
              <span className="mt-1 flex items-center gap-1.5 text-xs text-type-dimmed">
                <Icon icon={Icons.EYE} className="text-[0.7rem]" />
                {party.watching} watching
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
