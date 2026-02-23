import type { AiDiffIndicatorType } from "../../../lib/diff";

export type DeletionDividerLayout = {
  top: number;
  left: number;
  width: number;
};

export type MarkerLayout = {
  blockId: string;
  top: number;
  height: number;
  indicatorType: AiDiffIndicatorType;
  blockTop: number;
  blockLeft: number;
  blockWidth: number;
};
