import { AlwaysStencilFunc, KeepStencilOp, NotEqualStencilFunc, ReplaceStencilOp } from "three";

export const CUT_SURFACE_STENCIL = {
  stencilWrite: true,
  stencilRef: 1,
  stencilFunc: AlwaysStencilFunc,
  stencilZPass: ReplaceStencilOp,
};

export function connectivityCutMask(enabled: boolean) {
  return {
    stencilWrite: enabled,
    stencilWriteMask: 0,
    stencilRef: CUT_SURFACE_STENCIL.stencilRef,
    stencilFunc: NotEqualStencilFunc,
    stencilFail: KeepStencilOp,
    stencilZFail: KeepStencilOp,
    stencilZPass: KeepStencilOp,
  };
}
