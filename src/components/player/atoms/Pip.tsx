import { Icons } from "@/components/Icon";
import { VideoPlayerButton } from "@/components/player/internals/Button";
import { usePlayerStore } from "@/stores/player/store";
import {
  canPictureInPicture,
  canWebkitPictureInPicture,
} from "@/utils/detectFeatures";

export function Pip() {
  const display = usePlayerStore((s) => s.display);
  // an embedded player's video is out of reach, so it cannot be popped out
  const isEmbed = usePlayerStore((s) => s.source?.type === "embed");

  if (isEmbed) return null;
  if (!canPictureInPicture() && !canWebkitPictureInPicture()) return null;

  return (
    <VideoPlayerButton
      onClick={() => display?.togglePictureInPicture()}
      icon={Icons.PICTURE_IN_PICTURE}
    />
  );
}
