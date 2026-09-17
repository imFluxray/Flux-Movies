import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";

import { fetchOpenSubtitles } from "@/backend/providers/fluxRunner";
import { useCaptions } from "@/components/player/hooks/useCaptions";
import { Menu } from "@/components/player/internals/ContextMenu";
import { Input } from "@/components/player/internals/ContextMenu/Input";
import { convertProviderCaption } from "@/components/player/utils/captions";
import { useOverlayRouter } from "@/hooks/useOverlayRouter";
import { PlayerMeta, metaToScrapeMedia } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";

import { CaptionOption } from "./CaptionsView";
import { useSubtitleList } from "./SourceCaptionsView";

/*
 * OpenSubtitles is searched when this menu opens.
 *
 * It used to list only subtitles that arrived attached to the stream, and
 * almost no source attaches any - so it read "no subtitles" even for episodes
 * OpenSubtitles has dozens of files for. Results are added to the player's
 * caption list, which is what selecting one downloads from.
 */

// titles already searched this session, so reopening the menu is instant
const searched = new Set<string>();

function mediaKey(meta: PlayerMeta): string {
  return [
    meta.type,
    meta.tmdbId,
    meta.season?.number ?? "",
    meta.episode?.number ?? "",
  ].join(":");
}

export function OpenSubtitlesCaptionView({
  id,
  overlayBackLink,
}: {
  id: string;
  overlayBackLink?: true;
}) {
  const { t } = useTranslation();
  const router = useOverlayRouter(id);
  const selectedCaptionId = usePlayerStore((s) => s.caption.selected?.id);
  const [currentlyDownloading, setCurrentlyDownloading] = useState<
    string | null
  >(null);
  const { selectCaptionById } = useCaptions();
  const captionList = usePlayerStore((s) => s.captionList);
  const getHlsCaptionList = usePlayerStore((s) => s.display?.getCaptionList);
  const meta = usePlayerStore((s) => s.meta);
  const [searching, setSearching] = useState(false);

  const captions = useMemo(
    () =>
      captionList.length !== 0 ? captionList : (getHlsCaptionList?.() ?? []),
    [captionList, getHlsCaptionList],
  );
  const openSubtitles = useMemo(
    () => captions.filter((x) => x.opensubtitles),
    [captions],
  );

  useEffect(() => {
    if (!meta || openSubtitles.length) return undefined;
    const key = mediaKey(meta);
    if (searched.has(key)) return undefined;
    let media;
    try {
      media = metaToScrapeMedia(meta);
    } catch {
      // a show without its episode resolved yet: nothing to search for
      return undefined;
    }
    searched.add(key);
    let alive = true;
    setSearching(true);
    fetchOpenSubtitles(media)
      .then((found) => {
        if (alive) setSearching(false);
        // an empty answer is worth asking again next time the menu opens
        if (!found.length) {
          searched.delete(key);
          return;
        }
        const additions = convertProviderCaption(found);
        usePlayerStore.setState((state) => {
          // the viewer may have moved to another episode while this ran
          if (!state.meta || mediaKey(state.meta) !== key) return;
          const have = new Set(state.captionList.map((caption) => caption.id));
          additions.forEach((caption) => {
            if (!have.has(caption.id)) state.captionList.push(caption);
          });
        });
      })
      .catch(() => {
        searched.delete(key);
        if (alive) setSearching(false);
      });
    return () => {
      alive = false;
    };
  }, [meta, openSubtitles.length]);

  const [searchQuery, setSearchQuery] = useState("");
  const subtitleList = useSubtitleList(openSubtitles, searchQuery);

  const [downloadReq, startDownload] = useAsyncFn(
    async (captionId: string) => {
      setCurrentlyDownloading(captionId);
      return selectCaptionById(captionId);
    },
    [selectCaptionById, setCurrentlyDownloading],
  );

  const content = subtitleList.length
    ? subtitleList.map((v) => {
        return (
          <CaptionOption
            // key must use index to prevent url collisions
            key={v.id}
            countryCode={v.language}
            selected={v.id === selectedCaptionId}
            loading={v.id === currentlyDownloading && downloadReq.loading}
            error={
              v.id === currentlyDownloading && downloadReq.error
                ? downloadReq.error.toString()
                : undefined
            }
            onClick={() => startDownload(v.id)}
          >
            {v.languageName}
          </CaptionOption>
        );
      })
    : t("player.menus.subtitles.notFound");

  return (
    <>
      <div>
        <Menu.BackLink
          onClick={() =>
            router.navigate(overlayBackLink ? "/captionsOverlay" : "/captions")
          }
        >
          {t("player.menus.subtitles.OpenSubtitlesChoice")}
        </Menu.BackLink>
      </div>
      {openSubtitles.length ? (
        <div className="mt-3">
          <Input value={searchQuery} onInput={setSearchQuery} />
        </div>
      ) : null}
      <Menu.ScrollToActiveSection className="!pt-1 mt-2 pb-3">
        {openSubtitles.length ? (
          <div className="text-center">{content}</div>
        ) : (
          <div className="p-4 rounded-xl bg-video-context-light bg-opacity-10 font-medium text-center">
            <div className="flex flex-col items-center justify-center gap-3">
              {searching
                ? "Searching OpenSubtitles…"
                : t("player.menus.subtitles.empty")}
            </div>
          </div>
        )}
      </Menu.ScrollToActiveSection>
    </>
  );
}

export default OpenSubtitlesCaptionView;
