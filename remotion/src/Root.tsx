import React from 'react';
import { Composition } from 'remotion';
import { SubtitleOverlay } from './SubtitleOverlay';
import { ImageSlide } from './ImageSlide';
import { ImageSlideshow } from './ImageSlideshow';

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
    <Composition
      id="ImageSlideshow"
      component={ImageSlideshow}
      durationInFrames={900}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{
        images: [],
        transitionDuration: 15,
        title: 'My Video',
      }}
    />
  </>
);
