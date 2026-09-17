import classNames from "classnames";
import { useEffect, useMemo, useState } from "react";

import { base64ToBuffer, decryptData } from "@/backend/accounts/crypto";
import { Icon, Icons } from "@/components/Icon";
import { UserIcon } from "@/components/UserIcon";
import { AccountProfile } from "@/pages/parts/auth/AccountCreatePart";
import { useAuthStore } from "@/stores/auth";
import { useProfileStore } from "@/stores/profiles";

export interface AvatarProps {
  profile: AccountProfile["profile"] & { avatarUrl?: string };
  sizeClass?: string;
  iconClass?: string;
  bottom?: React.ReactNode;
}

export function Avatar(props: AvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [props.profile.avatarUrl]);
  return (
    <div className="relative inline-block">
      <div
        className={classNames(
          props.sizeClass,
          "rounded-full overflow-hidden flex items-center justify-center text-white",
        )}
        style={{
          background: `linear-gradient(to bottom right, ${props.profile.colorA}, ${props.profile.colorB})`,
        }}
      >
        {props.profile.avatarUrl && !imageFailed ? (
          <img
            src={props.profile.avatarUrl}
            alt=""
            onError={() => setImageFailed(true)}
            className="block h-full w-full object-cover object-center"
          />
        ) : (
          <UserIcon
            className={props.iconClass}
            icon={props.profile.icon as any}
          />
        )}
      </div>
      {props.bottom ? (
        <div className="absolute bottom-0 left-1/2 transform translate-y-1/2 -translate-x-1/2">
          {props.bottom}
        </div>
      ) : null}
    </div>
  );
}

export function UserAvatar(props: {
  sizeClass?: string;
  iconClass?: string;
  bottom?: React.ReactNode;
  withName?: boolean;
}) {
  const auth = useAuthStore();

  const bufferSeed = useMemo(
    () =>
      auth.account && auth.account.seed
        ? base64ToBuffer(auth.account.seed)
        : null,
    [auth],
  );

  if (!auth.account || auth.account === null) return null;

  const deviceName = bufferSeed
    ? decryptData(auth.account.deviceName, bufferSeed)
    : "...";

  return (
    <>
      <Avatar
        profile={auth.account.profile}
        sizeClass={
          props.sizeClass ?? "w-[1.5rem] h-[1.5rem] ssm:w-[2rem] ssm:h-[2rem]"
        }
        iconClass={props.iconClass}
        bottom={props.bottom}
      />
      {props.withName && bufferSeed ? (
        <span className="hidden md:inline-block">
          {deviceName.length >= 20
            ? `${deviceName.slice(0, 20 - 1)}…`
            : deviceName}
        </span>
      ) : null}
    </>
  );
}

export function NoUserAvatar(props: { iconClass?: string }) {
  return (
    <div className="relative inline-block p-1 text-type-dimmed">
      <Icon
        className={props.iconClass ?? "text-base ssm:text-xl"}
        icon={Icons.MENU}
      />
    </div>
  );
}

export function LocalProfileAvatar() {
  const profiles = useProfileStore((state) => state.profiles);
  const activeId = useProfileStore((state) => state.activeId);
  const profile = profiles.find((candidate) => candidate.id === activeId);
  if (!profile) return <NoUserAvatar />;
  return (
    <>
      <Avatar profile={profile} sizeClass="h-8 w-8" iconClass="text-sm" />
      <span className="hidden max-w-28 truncate md:inline">{profile.name}</span>
    </>
  );
}
