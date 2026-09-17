import { useCallback, useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";

import { useDebounce } from "@/hooks/useDebounce";
import { useRandomTranslation } from "@/hooks/useRandomTranslation";
import { useSearchQuery } from "@/hooks/useSearchQuery";
import { HomeLayout } from "@/pages/layouts/HomeLayout";
import { AlgoHero } from "@/pages/parts/home/AlgoHero";
import { BookmarksPart } from "@/pages/parts/home/BookmarksPart";
import { HomeSearch } from "@/pages/parts/home/HomeSearch";
import { LivePartiesStrip } from "@/pages/parts/home/LivePartiesStrip";
import { MediaRow, RowSwitcher } from "@/pages/parts/home/MediaRow";
import { WatchingPart } from "@/pages/parts/home/WatchingPart";
import { SearchListPart } from "@/pages/parts/search/SearchListPart";
import { SearchLoadingPart } from "@/pages/parts/search/SearchLoadingPart";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useProgressStore } from "@/stores/progress";
import { useTasteStore } from "@/stores/taste";
import { FeedItem, getRecommendations } from "@/utils/algorithm";
import {
  DEFAULT_GENRE_ID,
  GENRE_KEY,
  PROVIDER_KEY,
  WATCH_PROVIDERS,
  fetchByGenre,
  fetchGenres,
  fetchOnlyOn,
  fetchTopRated,
  fetchTrendingToday,
  readPref,
  writePref,
} from "@/utils/homeFeed";

function useSearch(search: string) {
  const [searching, setSearching] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const debouncedSearch = useDebounce<string>(search, 500);
  useEffect(() => {
    setSearching(search !== "");
    setLoading(search !== "");
  }, [search]);
  useEffect(() => {
    setLoading(false);
  }, [debouncedSearch]);

  return { loading, searching };
}

export function HomePage() {
  const { t } = useTranslation();
  const { t: randomT } = useRandomTranslation();
  const [showBg, setShowBg] = useState<boolean>(false);
  const searchParams = useSearchQuery();
  const [search] = searchParams;
  const s = useSearch(search);

  // the old giant headline copy now serves as the search placeholder
  const placeholder = randomT("home.search.placeholder") ?? "";

  const progressItems = useProgressStore((st) => st.items);
  const bookmarks = useBookmarkStore((st) => st.bookmarks);
  const likes = useTasteStore((st) => st.likes);

  const [hero, setHero] = useState<FeedItem[]>([]);
  const [heroLoading, setHeroLoading] = useState(true);

  const [top10, setTop10] = useState<FeedItem[]>([]);
  const [trending, setTrending] = useState<FeedItem[]>([]);
  const [topRated, setTopRated] = useState<FeedItem[]>([]);
  const [rowsLoading, setRowsLoading] = useState(true);

  const [providerId, setProviderId] = useState(() =>
    readPref(PROVIDER_KEY, WATCH_PROVIDERS[0].id),
  );
  const [providerItems, setProviderItems] = useState<FeedItem[]>([]);
  const [providerLoading, setProviderLoading] = useState(true);

  const [genres, setGenres] = useState<{ id: number; name: string }[]>([]);
  const [genreId, setGenreId] = useState(() =>
    readPref(GENRE_KEY, DEFAULT_GENRE_ID),
  );
  const [genreItems, setGenreItems] = useState<FeedItem[]>([]);
  const [genreLoading, setGenreLoading] = useState(true);

  // Re-rank when the user explicitly likes a title. Progress and saved-title
  // changes wait until the next visit so passive activity cannot shuffle the
  // page underneath them.
  useEffect(() => {
    let alive = true;
    getRecommendations(progressItems, bookmarks, likes)
      .then(({ items }) => {
        if (!alive) return;
        setHero(items);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setHeroLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [likes]);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchTrendingToday(), fetchTopRated()])
      .then(([today, rated]) => {
        if (!alive) return;
        setTop10(today.top10);
        setTrending(today.rest);
        setTopRated(rated);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setRowsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setProviderLoading(true);
    fetchOnlyOn(providerId)
      .then((items) => {
        if (alive) setProviderItems(items);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setProviderLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [providerId]);

  useEffect(() => {
    let alive = true;
    fetchGenres()
      .then((g) => {
        if (alive) setGenres(g);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setGenreLoading(true);
    fetchByGenre(genreId)
      .then((items) => {
        if (alive) setGenreItems(items);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setGenreLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [genreId]);

  const onProvider = useCallback((id: number) => {
    setProviderId(id);
    writePref(PROVIDER_KEY, id);
  }, []);

  const onGenre = useCallback((id: number) => {
    setGenreId(id);
    writePref(GENRE_KEY, id);
  }, []);

  const genreName = useMemo(
    () => genres.find((g) => g.id === genreId)?.name ?? "Comedy",
    [genres, genreId],
  );

  // the nav gets a solid backdrop once the hero has scrolled away
  useEffect(() => {
    function onScroll() {
      setShowBg(window.scrollY > 80);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const searchSlot = (
    <HomeSearch searchParams={searchParams} placeholder={placeholder} />
  );

  return (
    <HomeLayout showBg={showBg || s.searching} searchSlot={searchSlot}>
      <Helmet>
        <style type="text/css">{`
          html, body { scrollbar-gutter: stable; }
        `}</style>
        <title>{t("global.name")}</title>
      </Helmet>

      {s.searching ? (
        <div className="mx-auto w-full max-w-[1400px] px-6 pb-16 pt-32 sm:px-10">
          {s.loading ? (
            <SearchLoadingPart />
          ) : (
            <SearchListPart searchQuery={search} />
          )}
        </div>
      ) : (
        <>
          <AlgoHero items={hero} loading={heroLoading} />

          <div className="mx-auto w-full max-w-[1400px] px-6 pb-24 sm:px-10">
            {/* only shows itself while rooms are actually open */}
            <LivePartiesStrip />

            <div className="flex flex-col gap-8">
              <WatchingPart onItemsChange={() => {}} />
              <BookmarksPart onItemsChange={() => {}} />
            </div>

            <div className="mt-10 flex flex-col gap-10">
              <MediaRow
                title="Top 10 Today"
                items={top10}
                loading={rowsLoading}
                ranked
              />
              <MediaRow
                title="Trending Today"
                items={trending}
                loading={rowsLoading}
              />
              <MediaRow
                title="Only on"
                items={providerItems}
                loading={providerLoading}
                control={
                  <RowSwitcher
                    kind="provider"
                    options={WATCH_PROVIDERS}
                    value={providerId}
                    onChange={onProvider}
                  />
                }
              />
              <MediaRow
                title="Top Rated"
                items={topRated}
                loading={rowsLoading}
              />
              <MediaRow
                title=""
                items={genreItems}
                loading={genreLoading}
                control={
                  genres.length ? (
                    <RowSwitcher
                      kind="genre"
                      options={genres}
                      value={genreId}
                      onChange={onGenre}
                    />
                  ) : (
                    <span className="text-lg font-semibold tracking-tight text-white sm:text-xl">
                      {genreName}
                    </span>
                  )
                }
              />
            </div>
          </div>
        </>
      )}
    </HomeLayout>
  );
}
