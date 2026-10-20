import React from "react";
import { Composition, Still, type CalculateMetadataFunction } from "remotion";
import type { RenderProps } from "../src/lib/schemas";
import { Documentary } from "./Documentary";
import { Thumbnail } from "./Thumbnail";
import { SAMPLE_PROPS } from "./sample";

const calc: CalculateMetadataFunction<RenderProps> = ({ props }) => ({
  durationInFrames: Math.max(1, props.durationInFrames),
  fps: props.fps,
  width: props.width,
  height: props.height,
});

const calcThumb: CalculateMetadataFunction<RenderProps> = ({ props }) => ({
  width: props.format === "9:16" ? 1080 : 1280,
  height: props.format === "9:16" ? 1920 : 720,
});

export const Root: React.FC = () => (
  <>
    <Composition id="Documentary" component={Documentary} defaultProps={SAMPLE_PROPS} calculateMetadata={calc} durationInFrames={300} fps={30} width={1920} height={1080} />
    <Still id="Thumbnail" component={Thumbnail} defaultProps={SAMPLE_PROPS} calculateMetadata={calcThumb} width={1280} height={720} />
  </>
);
