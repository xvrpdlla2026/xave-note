import { Composition } from "remotion";
import { Xave } from "./Video";

export const Root: React.FC = () => (
  <Composition
    id="Xave"
    component={Xave}
    durationInFrames={900}
    fps={30}
    width={1920}
    height={1080}
  />
);
