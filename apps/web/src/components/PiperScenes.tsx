import type { ReactNode } from 'react';

export type PiperSceneVariant = 'repos' | 'feature' | 'settings';

/** The piper silhouette shared by the mark and the scenes, drawn in a 40×40 box. */
const Piper = ({ transform }: { transform: string }) => (
  <g fill="#fff" transform={transform}>
    <path className="ft" d="M21.4 10.6 C25.2 6.4 30.2 3.9 36.6 3.4 C32.4 6 28.9 9.3 26.2 14 C25 12.6 23.3 11.4 21.4 10.6 Z" />
    <path d="M12.6 14.4 C14.4 10 20.4 8.6 24 12.4 L22.6 13.3 C19.6 10.6 15.6 11.5 14 15 Z" />
    <circle cx="18.2" cy="15.6" r="4.1" />
    <path d="M2.6 21.6 L14.6 16.9 L15.5 18.9 L3.5 23.6 Z" />
    <circle cx="11.6" cy="19.1" r="2" />
    <path d="M16.6 19.6 L21.2 19.4 C25.4 21.3 27.4 26.4 27 36.6 L13.4 36.6 C13 30.2 13.9 24.6 16.6 19.6 Z" />
    <path className="cape" d="M22.8 20.6 C28.4 22.6 33.8 27.6 37 36 C34.4 36.7 31.6 36.7 28.9 36.5 C29.8 30.2 27.8 25.2 22.8 20.6 Z" opacity=".88" />
  </g>
);

const Notes = ({ x, y, className = '' }: { x: number; y: number; className?: string }) => (
  <g className={`notes ${className}`} fill="#fff">
    <circle className="note n1" cx={x} cy={y} r="2.2" />
    <circle className="note n2" cx={x} cy={y} r="1.8" />
    <circle className="note n3" cx={x} cy={y} r="1.4" />
  </g>
);

const TONES: Record<PiperSceneVariant, [string, string]> = { repos: ['#118a53', '#063d25'], feature: ['#17995c', '#0a4a2e'], settings: ['#0b6b3f', '#04301c'] };

/** The piper leads a procession of repositories: three blocks follow the flute. */
const ReposScene = () => (
  <>
    <Piper transform="translate(28 10) scale(1.3)" />
    <Notes x={31} y={38} className="to-left" />
    <g fill="#fff" className="followers">
      <g className="follower f1"><rect x="92" y="46" width="16" height="16" rx="4" /><circle cx="100" cy="54" r="2.6" fill={TONES.repos[1]} /></g>
      <g className="follower f2"><rect x="114" y="50" width="12" height="12" rx="3.5" /><circle cx="120" cy="56" r="2" fill={TONES.repos[1]} /></g>
      <g className="follower f3"><rect x="132" y="53" width="9" height="9" rx="3" /><circle cx="136.5" cy="57.5" r="1.5" fill={TONES.repos[1]} /></g>
    </g>
  </>
);

/** The piper's tune gathers into something new: notes drift up and light a spark. */
const FeatureScene = () => (
  <>
    <Piper transform="translate(78 12) scale(1.25)" />
    <Notes x={81} y={39} className="to-spark" />
    <g className="spark">
      <circle cx="36" cy="26" r="15" fill="#fff" opacity=".16" />
      <path fill="#fff" d="M36 11 L39.6 21.4 L50 25 L39.6 28.6 L36 39 L32.4 28.6 L22 25 L32.4 21.4 Z" />
    </g>
  </>
);

/** The piper tunes the instrument: three sliders set the levels. */
const SettingsScene = () => (
  <>
    <Piper transform="translate(14 10) scale(1.3)" />
    <Notes x={17} y={38} className="to-left" />
    <g stroke="#fff" strokeLinecap="round" fill="#fff" className="sliders">
      <line x1="96" y1="24" x2="146" y2="24" strokeWidth="2" opacity=".35" /><line x1="96" y1="24" x2="118" y2="24" strokeWidth="3" /><circle cx="118" cy="24" r="4" stroke="none" />
      <line x1="96" y1="37" x2="146" y2="37" strokeWidth="2" opacity=".35" /><line x1="96" y1="37" x2="136" y2="37" strokeWidth="3" /><circle cx="136" cy="37" r="4" stroke="none" />
      <line x1="96" y1="50" x2="146" y2="50" strokeWidth="2" opacity=".35" /><line x1="96" y1="50" x2="106" y2="50" strokeWidth="3" /><circle className="knob" cx="106" cy="50" r="4" stroke="none" />
    </g>
  </>
);

const SCENES: Record<PiperSceneVariant, () => ReactNode> = { repos: ReposScene, feature: FeatureScene, settings: SettingsScene };

/** A small picture of the piper for the front door: one version of the mark per place to go. */
export const PiperScene = ({ variant, title }: { variant: PiperSceneVariant; title?: string }) => {
  const [light, dark] = TONES[variant];
  const Scene = SCENES[variant];
  return (
    <svg className={`piper-mark piper-scene is-${variant}`} viewBox="0 0 160 72" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <defs>
        <linearGradient id={`pp-bg-${variant}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="1" stopColor={dark} />
        </linearGradient>
      </defs>
      <rect width="160" height="72" rx="12" fill={`url(#pp-bg-${variant})`} />
      <Scene />
    </svg>
  );
};
