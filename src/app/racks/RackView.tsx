"use client";

import { useState } from "react";
import { AuditLogModal, fetchAuditLogs } from "@/components/AuditLogModal";
import type { Location, Rack, Asset, DistFrame, Team } from "./parts/types";
import { hasWarning } from "./parts/placement";
import { useRackPlacement } from "./parts/useRackPlacement";
import { useRackAdd } from "./parts/useRackAdd";
import { RackFilterBar } from "./parts/RackFilterBar";
import { RackAddForm } from "./parts/RackAddForm";
import { UnplacedPanel } from "./parts/UnplacedPanel";
import { RackCanvas } from "./parts/RackCanvas";
import { AssetContextMenu } from "./parts/AssetContextMenu";

export type { Asset, Location, Rack, DistFrame, Team };

export function RackView({
  locations,
  racks,
  assets,
  unplacedAssets = [],
  distFrames = [],
  canWrite = false,
  teams = [],
  isAdmin = false,
}: {
  locations: Location[];
  racks: Rack[];
  assets: Asset[];
  unplacedAssets?: Asset[];
  distFrames?: DistFrame[];
  canWrite?: boolean;
  teams?: Team[];
  isAdmin?: boolean;
}) {
  const [selectedLocation, setSelectedLocation] = useState<number | "">("");
  const [hoveredAsset, setHoveredAsset] = useState<Asset | null>(null);
  const [hoveredConflict, setHoveredConflict] = useState<Asset[] | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [auditLogs, setAuditLogs] = useState<Awaited<ReturnType<typeof fetchAuditLogs>>>(null);
  const [auditRackName, setAuditRackName] = useState("");
  const [rackSearch, setRackSearch] = useState("");
  const [showWarningsOnly, setShowWarningsOnly] = useState(false);
  const [unplacedSearch, setUnplacedSearch] = useState("");
  const [unplacedType, setUnplacedType] = useState("");

  const placement = useRackPlacement(assets, canWrite);
  const rackAdd = useRackAdd(locations, selectedLocation);

  const filteredRacks = racks.filter((r) => {
    if (selectedLocation && r.location_id !== selectedLocation) return false;
    if (rackSearch && !r.rack_name.toLowerCase().includes(rackSearch.toLowerCase())) return false;
    if (showWarningsOnly && !hasWarning(r.id, r.total_units, assets)) return false;
    return true;
  });

  return (
    <div>
      <RackFilterBar
        racks={racks}
        assets={assets}
        locations={locations}
        selectedLocation={selectedLocation}
        setSelectedLocation={setSelectedLocation}
        rackSearch={rackSearch}
        setRackSearch={setRackSearch}
        showWarningsOnly={showWarningsOnly}
        setShowWarningsOnly={setShowWarningsOnly}
        canWrite={canWrite}
        onOpenAddForm={rackAdd.openAddForm}
      />

      {rackAdd.showAddForm && canWrite && (
        <RackAddForm
          locations={locations}
          teams={teams}
          isAdmin={isAdmin}
          addForm={rackAdd.addForm}
          setAddForm={rackAdd.setAddForm}
          saving={rackAdd.saving}
          onSave={rackAdd.saveNewRack}
          onClose={() => rackAdd.setShowAddForm(false)}
          addNameRef={rackAdd.addNameRef}
        />
      )}

      <div className="flex gap-6 items-start">
        {canWrite && (
          <UnplacedPanel
            unplacedAssets={unplacedAssets}
            dragAsset={placement.dragAsset}
            unplacedSearch={unplacedSearch}
            setUnplacedSearch={setUnplacedSearch}
            unplacedType={unplacedType}
            setUnplacedType={setUnplacedType}
            onStartDrag={placement.startDrag}
            onEndDrag={placement.endDrag}
            onPlaceAsset={placement.placeAsset}
          />
        )}
        <RackCanvas
          filteredRacks={filteredRacks}
          assets={assets}
          distFrames={distFrames}
          canWrite={canWrite}
          dragAsset={placement.dragAsset}
          dropTarget={placement.dropTarget}
          hoveredAsset={hoveredAsset}
          setHoveredAsset={setHoveredAsset}
          hoveredConflict={hoveredConflict}
          setHoveredConflict={setHoveredConflict}
          tooltipPos={tooltipPos}
          setTooltipPos={setTooltipPos}
          onSlotDragOver={placement.slotDragOver}
          onSlotDrop={placement.slotDrop}
          onOpenCtxMenu={(e, menuAssets) => {
            setHoveredAsset(null);
            setHoveredConflict(null);
            placement.openCtxMenu(e, menuAssets);
          }}
          onStartDrag={(e, a) => {
            setHoveredAsset(null);
            setHoveredConflict(null);
            placement.startDrag(e, a);
          }}
          onEndDrag={placement.endDrag}
          onFetchAuditLogs={async (rackId, rackName) => {
            const logs = await fetchAuditLogs("rack", rackId);
            if (logs) {
              setAuditLogs(logs);
              setAuditRackName(rackName);
            }
          }}
        />
      </div>

      {placement.ctxMenu && (
        <AssetContextMenu
          ctxMenu={placement.ctxMenu}
          onClose={() => placement.setCtxMenu(null)}
          distFrames={distFrames}
          onUnrack={placement.unrackFromMenu}
        />
      )}

      {auditLogs !== null && (
        <AuditLogModal logs={auditLogs} title={auditRackName} onClose={() => setAuditLogs(null)} />
      )}
    </div>
  );
}
