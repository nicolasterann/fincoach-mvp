// Bloque N0 — el ÚNICO módulo por el que se importan los estados. Si una
// pantalla necesita un estado, sale de aquí; si no está aquí, no existe.

export {
  KipuLoading,
  KipuEmpty,
  KipuNoData,
  KipuOffline,
  KipuError,
  KipuState,
  type KipuStateProps,
} from "./KipuState";

export {
  KIPU_STATE_AXES,
  KIPU_STATE_KINDS,
  KIPU_STATE_SHAPES,
  KIPU_UNMEASURED,
  formatMetric,
  isMeasured,
  kipuStateContract,
  stateDifferences,
  stateMayRenderZero,
  statesAreDistinguishable,
  type FormatMetricOptions,
  type KipuStateClaim,
  type KipuStateContract,
  type KipuStateKind,
  type KipuStateShape,
  type KipuStateSilhouette,
} from "./state-contract";
