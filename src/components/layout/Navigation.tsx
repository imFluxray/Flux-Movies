import classNames from "classnames";
import { ReactNode } from "react";
import { Link } from "react-router-dom";

import { LocalProfileAvatar, UserAvatar } from "@/components/Avatar";
import { Icon, Icons } from "@/components/Icon";
import { DonateButton } from "@/components/layout/DonateButton";
import { PartiesNavButton } from "@/components/layout/PartiesNavButton";
import { LinksDropdown } from "@/components/LinksDropdown";
import { Lightbar } from "@/components/utils/Lightbar";
import { useAuth } from "@/hooks/auth/useAuth";
import { BlurEllipsis } from "@/pages/layouts/SubPageLayout";
import { conf } from "@/setup/config";
import { useBannerSize } from "@/stores/banner";

import { BrandPill } from "./BrandPill";

export interface NavigationProps {
  bg?: boolean;
  noLightbar?: boolean;
  doBackground?: boolean;
  /** optional content for the empty middle of the bar, e.g. the home search */
  searchSlot?: ReactNode;
}

export function Navigation(props: NavigationProps) {
  const bannerHeight = useBannerSize();
  const { loggedIn } = useAuth();

  return (
    <>
      {/* lightbar */}
      {!props.noLightbar ? (
        <div
          className="absolute inset-x-0 top-0 flex h-[88px] items-center justify-center"
          style={{
            top: `${bannerHeight}px`,
          }}
        >
          <div className="absolute inset-x-0 -mt-[22%] flex items-center sm:mt-0">
            <Lightbar />
          </div>
        </div>
      ) : null}

      {/* backgrounds - these are seperate because of z-index issues */}
      <div
        className="fixed z-[20] pointer-events-none left-0 right-0 top-0 min-h-[150px]"
        style={{
          top: `${bannerHeight}px`,
        }}
      >
        <div
          className={classNames(
            "fixed left-0 right-0 h-20 flex items-center",
            props.doBackground
              ? "bg-background-main border-b border-utils-divider border-opacity-50"
              : null,
          )}
        >
          {props.doBackground ? (
            <div className="absolute w-full h-full inset-0 overflow-hidden">
              <BlurEllipsis positionClass="absolute" />
            </div>
          ) : null}
          <div className="opacity-0 absolute inset-0 block h-20 pointer-events-auto" />
          <div
            className={`${
              props.bg ? "opacity-100" : "opacity-0"
            } absolute inset-0 block h-24 bg-gradient-to-b from-background-main via-background-main/70 to-transparent transition-opacity duration-300`}
          >
            {/* Was a solid bg-background-main block: invisible against
                the old blue hero, but a hard black bar over the red one.
                Fading it out keeps the nav readable without the edge. */}
          </div>
        </div>
      </div>

      {/* content */}
      <div
        className="fixed pointer-events-none left-0 right-0 z-[60] top-0 min-h-[150px]"
        style={{
          top: `${bannerHeight}px`,
        }}
      >
        <div className={classNames("fixed left-0 right-0 flex items-center")}>
          <div className="px-7 py-5 relative z-[60] flex flex-1 items-center justify-between">
            <div className="flex items-center space-x-1.5 ssm:space-x-3 pointer-events-auto">
              <Link
                className="block tabbable rounded-full text-xs ssm:text-base"
                to="/"
                onClick={() => window.scrollTo(0, 0)}
              >
                <BrandPill clickable header />
              </Link>
              <a
                href={conf().DISCORD_LINK}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-full bg-pill-background bg-opacity-50 px-3 py-1.5 text-sm text-white backdrop-blur-lg transition-[background,transform] duration-100 hover:scale-105 hover:bg-pill-backgroundHover tabbable"
              >
                <Icon icon={Icons.DISCORD} className="text-base" />
                <span className="hidden sm:inline">Discord</span>
              </a>
              <a
                href={conf().GITHUB_LINK}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-full bg-pill-background bg-opacity-50 px-3 py-1.5 text-sm text-white backdrop-blur-lg transition-[background,transform] duration-100 hover:scale-105 hover:bg-pill-backgroundHover tabbable"
              >
                <Icon icon={Icons.GITHUB} className="text-base" />
                <span className="hidden sm:inline">GitHub</span>
              </a>
              <PartiesNavButton />
              <DonateButton />
            </div>
            <div className="flex items-center gap-2 pointer-events-auto">
              {props.searchSlot ?? null}
              <div className="relative">
                <LinksDropdown>
                  {loggedIn ? <UserAvatar withName /> : <LocalProfileAvatar />}
                </LinksDropdown>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
