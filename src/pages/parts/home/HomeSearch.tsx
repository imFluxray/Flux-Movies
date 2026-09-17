import classNames from "classnames";
import { useEffect, useRef, useState } from "react";

import { Icon, Icons } from "@/components/Icon";
import { useSlashFocus } from "@/components/player/hooks/useSlashFocus";
import { useSearchQuery } from "@/hooks/useSearchQuery";

/*
 * The header search.
 *
 * Collapsed it is just an icon; clicking or pressing "/" unfolds it into a
 * field. The playful line that used to be the page's giant headline now lives
 * here as the placeholder, which is where it earns its keep - it tells you
 * what the box is for instead of shouting at you above the fold.
 */

export function HomeSearch(props: {
  searchParams: ReturnType<typeof useSearchQuery>;
  placeholder: string;
}) {
  const [search, setSearch, commit] = props.searchParams;
  // a query in the url means the user arrived mid-search; stay open for them
  const [open, setOpen] = useState(search.length > 0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  useSlashFocus(inputRef);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // "/" should unfold the box, not just focus a hidden input
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || open) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      e.preventDefault();
      setOpen(true);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current?.contains(e.target as Node)) return;
      // only fold away again if there is nothing to keep showing
      if (search.length === 0) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, search]);

  return (
    <div
      ref={wrapRef}
      className="pointer-events-auto flex items-center justify-end"
    >
      <div
        className={classNames(
          "flex flex-none items-center overflow-hidden rounded-full border backdrop-blur transition-all duration-300 ease-out",
          open
            ? "min-w-[min(22rem,58vw)] border-white/15 bg-black/55"
            : "w-10 min-w-[2.5rem] border-transparent bg-black/30 hover:border-white/15 hover:bg-black/50",
        )}
      >
        <button
          type="button"
          aria-label={open ? "Search" : "Open search"}
          onClick={() => {
            setOpen(true);
            inputRef.current?.focus();
          }}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center text-white/70 transition-colors hover:text-white"
        >
          <Icon icon={Icons.SEARCH} className="text-base" />
        </button>

        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit();
              inputRef.current?.blur();
            }
            if (e.key === "Escape") {
              setSearch("", true);
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          onBlur={() => commit()}
          placeholder={props.placeholder}
          tabIndex={open ? 0 : -1}
          aria-hidden={!open}
          className={classNames(
            "min-w-0 flex-1 bg-transparent py-2 pr-3 text-sm text-white placeholder:text-type-dimmed focus:outline-none",
            !open && "pointer-events-none w-0 opacity-0",
          )}
        />

        {open && search.length > 0 ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setSearch("", true);
              inputRef.current?.focus();
            }}
            className="mr-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-white/50 transition-colors hover:text-white"
          >
            <Icon icon={Icons.X} className="text-xs" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
