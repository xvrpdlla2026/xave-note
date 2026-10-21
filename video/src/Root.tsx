import { Composition } from "remotion";
import { Xave } from "./Video";
import { XaveLive, LIVE_TOTAL } from "./Live";

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
