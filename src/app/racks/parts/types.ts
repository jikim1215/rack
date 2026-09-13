import type { LocationRow, RackRow, AssetRow, DistFrameRow, TeamRow } from "@/lib/db-types";

export type Asset = Pick<
  AssetRow,
  | "id"
  | "asset_name"
  | "asset_type"
  | "manufacturer"
  | "model"
  | "ip_address"
  | "status"
> & {
  rack_id: number | null;
  rack_unit_start: number | null;
  rack_unit_size: number;
  rack_side?: "L" | "R" | null;
};

export interface Location {
  id: number;
  location_name: string;
  rack_count?: number;
}

export interface Rack {
  id: number;
  rack_name: string;
  total_units: number;
  location_id: number;
  location_name: string | null;
  owner_team_name: string | null;
}

export type DistFrame = Pick<DistFrameRow, "id" | "rack_id" | "rack_unit_start" | "rack_unit_size">;

export type Team = Pick<TeamRow, "id" | "team_name">;

export interface DragAsset {
  id: number;
  name: string;
  size: number;
  fromRackId: number | null;
  fromUnitStart: number | null;
  side: "L" | "R" | null;
}

export interface DropTarget {
  rackId: number;
  unit: number;
}

export interface CtxMenuState {
  x: number;
  y: number;
  assets: Asset[];
}

export type Severity = "critical" | "warning" | "caution" | null;
