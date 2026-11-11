import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { SCENES } from "./timeline";
import { Background, BrandChip, Captions, Character, SceneFade } from "./ui";
import {
  BlendedScene,
  FeaturesScene,
  FirstScene,
  HookScene,
  OnlineScene,
  OutroScene,
  UnderstandScene,
} from "./scenes";

const SCENE_COMPONENTS: [keyof typeof SCENES, React.FC][] = [
  ["hook", HookScene],
  ["first", FirstScene],
  ["blended", BlendedScene],
  ["online", OnlineScene],
  ["features", FeaturesScene],
  ["understand", UnderstandScene],
  ["outro", OutroScene],
];

export const MadarekPromo: React.FC = () => {
  return (
    <AbsoluteFill>
      <Background />
      <Sequence
        name="Brand chip"
        from={SCENES.first.from}
        durationInFrames={SCENES.outro.from - SCENES.first.from}
      >
        <BrandChip />
      </Sequence>
      <Character />
      {SCENE_COMPONENTS.map(([key, Scene]) => (
        <Sequence key={key} name={key} from={SCENES[key].from} durationInFrames={SCENES[key].duration}>
          <SceneFade duration={SCENES[key].duration}>
            <Scene />
          </SceneFade>
        </Sequence>
      ))}
      <Captions />
    </AbsoluteFill>
  );
};
