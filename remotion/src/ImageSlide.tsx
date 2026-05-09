import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

interface Props {
  imageSrc: string;
  subtitle: string;
  duration: number;
}

export const ImageSlide: React.FC<Props> = ({ imageSrc, subtitle }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const opacity = interpolate(frame, [0, 10, durationInFrames - 10, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <AbsoluteFill>
        <Img src={imageSrc} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity }} />
      </AbsoluteFill>
      {subtitle && (
        <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 60 }}>
          <div style={{
            fontFamily: "'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif",
            fontSize: 64,
            fontWeight: 'bold',
            color: '#fff',
            textShadow: '0 0 20px rgba(0,0,0,0.9), 2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000',
            textAlign: 'center',
            maxWidth: '80%',
            lineHeight: 1.4,
            opacity,
          }}>
            {subtitle}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
