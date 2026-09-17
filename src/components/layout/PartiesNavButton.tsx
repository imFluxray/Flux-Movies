import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { listPublicParties } from "@/backend/party/api";
import { Icon, Icons } from "@/components/Icon";

/*
 * Watch parties are easy to miss behind a bare icon, so this says what it is
 * and shows how many rooms are live right now.
 */
const POLL_MS = 45000;

export function PartiesNavButton() {
  const navigate = useNavigate();
  const [live, setLive] = useState(0);

  useEffect(() => {
    let alive = true;
    const check = () => {
      listPublicParties()
        .then((rooms) => {
          if (alive) setLive(rooms.length);
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

  return (
    <button
      type="button"
      title="Watch parties"
      onClick={() => {
        window.scrollTo(0, 0);
        navigate("/parties");
      }}
      className="flex items-center gap-2 rounded-full bg-pill-background bg-opacity-50 px-3 py-1.5 text-sm text-white backdrop-blur-lg transition-[background,transform] duration-100 hover:scale-105 hover:bg-pill-backgroundHover tabbable"
    >
      <Icon icon={Icons.WATCH_PARTY} className="text-base" />
      <span className="hidden sm:inline">Parties</span>
      {live > 0 ? (
        <span className="flex items-center gap-1 rounded-full bg-[#FF2A32] px-1.5 py-0.5 text-[0.65rem] font-bold leading-none">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
          {live}
        </span>
      ) : null}
    </button>
  );
}
