import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig, Sequence, Audio } from 'remotion';

interface Image {
  src: string;
  caption?: string;
  duration?: number;
}

export interface ImageSlideshowProps {
  images: Image[];
  transitionDuration?: number;
  backgroundMusic?: string;
  title?: string;
}

export const ImageSlideshow: React.FC<ImageSlideshowProps> = ({
  images,
  transitionDuration = 15, // 0.5초 (30fps 기준)
  backgroundMusic,
  title,
}) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();

  // 각 이미지의 시작 프레임 계산
  const getImageTiming = () => {
    let currentFrame = 0;
    return images.map((img, index) => {
      const duration = (img.duration || 5) * fps; // 기본 5초
      const start = currentFrame;
      currentFrame += duration;
      return { start, duration, end: currentFrame };
    });
  };

  const timings = getImageTiming();
  const totalDuration = timings[timings.length - 1].end;

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* 배경 음악 */}
      {backgroundMusic && (
        <Audio src={backgroundMusic} volume={0.3} />
      )}

      {/* 제목 (첫 2초간 표시) */}
      {title && frame < fps * 2 && (
        <AbsoluteFill
          style={{
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 10,
          }}
        >
          <div
            style={{
              fontSize: 80,
              fontWeight: 'bold',
              color: 'white',
              textAlign: 'center',
              padding: 40,
              backgroundColor: 'rgba(0,0,0,0.7)',
              borderRadius: 20,
              opacity: interpolate(
                frame,
                [0, fps * 0.5, fps * 1.5, fps * 2],
                [0, 1, 1, 0]
              ),
            }}
          >
            {title}
          </div>
        </AbsoluteFill>
      )}

      {/* 이미지 슬라이드 */}
      {images.map((image, index) => {
        const { start, duration, end } = timings[index];
        
        // 현재 이미지가 표시되어야 하는지 확인
        if (frame < start || frame >= end) return null;

        const progress = (frame - start) / duration;
        
        // 켄 번즈 효과 (줌 & 팬)
        const scale = interpolate(progress, [0, 1], [1, 1.1]);
        
        // 페이드 인/아웃
        const opacity = interpolate(
          frame - start,
          [0, transitionDuration, duration - transitionDuration, duration],
          [0, 1, 1, 0],
          { extrapolateRight: 'clamp' }
        );

        // 스프링 애니메이션
        const springValue = spring({
          frame: frame - start,
          fps,
          config: {
            damping: 100,
            stiffness: 200,
            mass: 0.5,
          },
        });

        return (
          <Sequence key={index} from={start} durationInFrames={duration}>
            <AbsoluteFill>
              {/* 이미지 */}
              <Img
                src={image.src}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  opacity,
                  transform: `scale(${scale})`,
                }}
              />
              
              {/* 자막/캡션 */}
              {image.caption && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: 100,
                    left: '50%',
                    transform: `translateX(-50%) translateY(${interpolate(
                      springValue,
                      [0, 1],
                      [100, 0]
                    )}px)`,
                    padding: '20px 40px',
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    borderRadius: 10,
                    maxWidth: '80%',
                  }}
                >
                  <div
                    style={{
                      color: 'white',
                      fontSize: 32,
                      fontWeight: 600,
                      textAlign: 'center',
                      lineHeight: 1.5,
                    }}
                  >
                    {image.caption}
                  </div>
                </div>
              )}
            </AbsoluteFill>
          </Sequence>
        );
      })}

      {/* 엔딩 (마지막 1초) */}
      {frame >= totalDuration - fps && (
        <AbsoluteFill
          style={{
            justifyContent: 'center',
            alignItems: 'center',
            opacity: interpolate(
              frame,
              [totalDuration - fps, totalDuration],
              [0, 1]
            ),
          }}
        >
          <div
            style={{
              fontSize: 60,
              fontWeight: 'bold',
              color: 'white',
              textAlign: 'center',
            }}
          >
            Thanks for watching!
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};