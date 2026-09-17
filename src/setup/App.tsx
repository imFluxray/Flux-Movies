import { ReactElement, Suspense, lazy, useEffect, useState } from "react";
import { lazyWithPreload } from "react-lazy-with-preload";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";

import { convertLegacyUrl, isLegacyUrl } from "@/backend/metadata/getmeta";
import { generateQuickSearchMediaUrl } from "@/backend/metadata/tmdb";
import { FluxLibrarySync } from "@/components/FluxLibrarySync";
import { useOnlineListener } from "@/hooks/usePing";
import { AboutPage } from "@/pages/About";
import { AdminPage } from "@/pages/admin/AdminPage";
import VideoTesterView from "@/pages/developer/VideoTesterView";
import { Discover } from "@/pages/Discover";
import { DmcaPage, shouldHaveDmcaPage } from "@/pages/Dmca";
import MaintenancePage from "@/pages/errors/MaintenancePage";
import { NotFoundPage } from "@/pages/errors/NotFoundPage";
import { HomePage } from "@/pages/HomePage";
import { JipPage } from "@/pages/Jip";
import { LoginPage } from "@/pages/Login";
import { OnboardingPage } from "@/pages/onboarding/Onboarding";
import { OnboardingExtensionPage } from "@/pages/onboarding/OnboardingExtension";
import { OnboardingProxyPage } from "@/pages/onboarding/OnboardingProxy";
import { PartiesPage } from "@/pages/Parties";
import { INTENDED_PATH_KEY, ProfilesPage } from "@/pages/Profiles";
import { RegisterPage } from "@/pages/Register";
import { SupportPage } from "@/pages/Support";
import { TasteFinderPage } from "@/pages/TasteFinder";
import { Layout } from "@/setup/Layout";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useHistoryListener } from "@/stores/history";
import { LanguageProvider } from "@/stores/language";
import { useProfileStore } from "@/stores/profiles";
import { useProgressStore } from "@/stores/progress";
import { useTasteStore } from "@/stores/taste";

const DeveloperPage = lazy(() => import("@/pages/DeveloperPage"));
const TestView = lazy(() => import("@/pages/developer/TestView"));
const PlayerView = lazyWithPreload(() => import("@/pages/PlayerView"));
const SettingsPage = lazyWithPreload(() => import("@/pages/Settings"));

PlayerView.preload();
SettingsPage.preload();

function LegacyUrlView({ children }: { children: ReactElement }) {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const url = location.pathname;
    if (!isLegacyUrl(url)) return;
    convertLegacyUrl(location.pathname).then((convertedUrl) => {
      navigate(convertedUrl ?? "/", { replace: true });
    });
  }, [location.pathname, navigate]);

  if (isLegacyUrl(location.pathname)) return null;
  return children;
}

function QuickSearch() {
  const { query } = useParams<{ query: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (query) {
      generateQuickSearchMediaUrl(query).then((url) => {
        navigate(url ?? "/", { replace: true });
      });
    } else {
      navigate("/", { replace: true });
    }
  }, [query, navigate]);

  return null;
}

function QueryView() {
  const { query } = useParams<{ query: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (query) {
      navigate(`/browse/${query}`, { replace: true });
    } else {
      navigate("/", { replace: true });
    }
  }, [query, navigate]);

  return null;
}

function App() {
  useHistoryListener();
  useOnlineListener();
  const maintenance = false; // Shows maintance page
  const [showDowntime, setShowDowntime] = useState(maintenance);
  const profileSessionReady = useProfileStore((state) => state.sessionReady);
  const location = useLocation();
  const navigate = useNavigate();

  const handleButtonClick = () => {
    setShowDowntime(false);
  };

  useEffect(() => {
    const sessionToken = sessionStorage.getItem("downtimeToken");
    if (!sessionToken && maintenance) {
      setShowDowntime(true);
      sessionStorage.setItem("downtimeToken", "true");
    }
  }, [setShowDowntime, maintenance]);

  // Profiles are a true data boundary, not cosmetic avatars. Persist the
  // active library as it changes, then force a fresh choice every page load.
  useEffect(() => {
    let timer: number | null = null;
    const save = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const profileState = useProfileStore.getState();
        if (!profileState.sessionReady || !profileState.activeId) return;
        profileState.saveLibrary(profileState.activeId, {
          bookmarks: useBookmarkStore.getState().bookmarks,
          likes: useTasteStore.getState().likes,
          progress: useProgressStore.getState().items,
        });
      }, 350);
    };
    const unsubscribeBookmarks = useBookmarkStore.subscribe(save);
    const unsubscribeLikes = useTasteStore.subscribe(save);
    const unsubscribeProgress = useProgressStore.subscribe(save);
    return () => {
      if (timer) window.clearTimeout(timer);
      unsubscribeBookmarks();
      unsubscribeLikes();
      unsubscribeProgress();
    };
  }, []);

  useEffect(() => {
    if (!profileSessionReady && location.pathname !== "/profiles") {
      // remember it, query string included: a watch party invite is useless
      // if choosing a profile drops the code on the way through
      try {
        sessionStorage.setItem(
          INTENDED_PATH_KEY,
          `${location.pathname}${location.search}`,
        );
      } catch {
        // storage blocked: the chooser just falls back to the home page
      }
      navigate("/profiles", { replace: true });
    }
  }, [location.pathname, location.search, navigate, profileSessionReady]);

  return (
    <Layout>
      <LanguageProvider />
      <FluxLibrarySync />
      {!showDowntime && (
        <Routes>
          {/* functional routes */}
          <Route path="/s/:query" element={<QuickSearch />} />
          <Route path="/search/:type" element={<Navigate to="/browse" />} />
          <Route path="/search/:type/:query?" element={<QueryView />} />
          {/* pages */}
          <Route
            path="/media/:media"
            element={
              <LegacyUrlView>
                <Suspense fallback={null}>
                  <PlayerView />
                </Suspense>
              </LegacyUrlView>
            }
          />
          <Route
            path="/media/:media/:season/:episode"
            element={
              <LegacyUrlView>
                <Suspense fallback={null}>
                  <PlayerView />
                </Suspense>
              </LegacyUrlView>
            }
          />
          <Route path="/browse/:query?" element={<HomePage />} />
          <Route path="/" element={<HomePage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/profiles" element={<ProfilesPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route
            path="/onboarding/extension"
            element={<OnboardingExtensionPage />}
          />
          <Route path="/onboarding/proxy" element={<OnboardingProxyPage />} />
          {shouldHaveDmcaPage() ? (
            <Route path="/dmca" element={<DmcaPage />} />
          ) : null}
          {/* Support page */}
          <Route path="/support" element={<SupportPage />} />
          <Route path="/jip" element={<JipPage />} />
          {/* Discover page */}
          <Route path="/discover" element={<Discover />} />
          <Route path="/taste" element={<TasteFinderPage />} />
          <Route path="/parties" element={<PartiesPage />} />
          {/* Settings page */}
          <Route
            path="/settings"
            element={
              <Suspense fallback={null}>
                <SettingsPage />
              </Suspense>
            }
          />
          {/* admin routes */}
          <Route path="/admin" element={<AdminPage />} />
          {/* other */}
          <Route path="/dev" element={<DeveloperPage />} />
          <Route path="/dev/video" element={<VideoTesterView />} />
          {/* developer routes that can abuse workers are disabled in production */}
          {process.env.NODE_ENV === "development" ? (
            <Route path="/dev/test" element={<TestView />} />
          ) : null}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      )}
      {showDowntime && (
        <MaintenancePage onHomeButtonClick={handleButtonClick} />
      )}
    </Layout>
  );
}

export default App;
