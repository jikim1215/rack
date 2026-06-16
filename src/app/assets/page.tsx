import { getDb } from "@/lib/db";
import Link from "next/link";
import { AssetTable } from "./AssetTable";

export default function AssetsPage({ searchParams }: { searchParams: Promise<{ type?: string; status?: string; q?: string }> }) {
  return <AssetsPageInner />;
}

function AssetsPageInner() {
  const db = getDb();
  const assets = db.prepare(`
    SELECT a.*, r.name as rack_name, l.name as location_name
    FROM assets a
    LEFT JOIN racks r ON a.rack_id = r.id
    LEFT JOIN locations l ON r.location_id = l.id
    ORDER BY a.created_at DESC
  `).all() as any[];

  const racks = db.prepare("SELECT r.id, r.name, l.name as location_name FROM racks r LEFT JOIN locations l ON r.location_id = l.id ORDER BY r.name").all() as any[];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">자산관리</h2>
      </div>
      <AssetTable assets={assets} racks={racks} />
    </div>
  );
}
