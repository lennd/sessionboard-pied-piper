export const TRAVEL_FRACTION = 0.55;

export type Phase = { tokenProgress: number | null; activated: boolean };

export const stepPhase = (progress: number, hasTravel: boolean): Phase =>
  hasTravel && progress < TRAVEL_FRACTION
    ? { tokenProgress: Math.max(0, progress) / TRAVEL_FRACTION, activated: false }
    : { tokenProgress: null, activated: true };
