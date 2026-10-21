import { Composition } from "remotion";
import { Xave } from "./Video";
import { XaveLive, LIVE_TOTAL } from "./Live";
import { XaveAd } from "./Ad";
import { XaveMesh } from "./Ad2";
import { AD_TOTAL } from "./ad-scenes";
import { MESH_TOTAL } from "./ad2-scenes";

export const Root: React.FC = () => (
  <>
    <Composition
      id="Xave"
      component={XaveLive}
      durationInFrames={LIVE_TOTAL}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition id="XaveMesh" component={XaveMesh} durationInFrames={MESH_TOTAL} fps={30} width={1920} height={1080} />
    <Composition id="XaveAd" component={XaveAd} durationInFrames={AD_TOTAL} fps={30} width={1920} height={1080} />
    <Composition
      id="XaveShort"
      component={Xave}
      durationInFrames={900}
      fps={30}
      width={1920}
      height={1080}
    />
  </>
);
