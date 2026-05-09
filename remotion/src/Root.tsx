import React from 'react';
import { Composition } from 'remotion';
import { SubtitleOverlay } from './SubtitleOverlay';
import { ImageSlide } from './ImageSlide';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="SubtitleOverlay"
      component={SubtitleOverlay}
      durationInFrames={900}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{
        videoSrc: '',
        subtitles: [],
        translatedSubtitles: [],
      }}
    />
    <Composition
      id="ImageSlide"
      component={ImageSlide}
      durationInFrames={150}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{
        imageSrc: '',
        subtitle: '',
        duration: 5,
      }}
    />
  </>
);
