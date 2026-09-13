"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import type { Location } from "./types";

export function useRackAdd(locations: Location[], selectedLocation: number | "") {
  const router = useRouter();
  const { addToast } = useToast();
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<{
    location_id: number;
    rack_name: string;
    total_units: number;
    description: string;
    team_id: number | "";
  }>({ location_id: 0, rack_name: "", total_units: 42, description: "", team_id: "" });
  const [saving, setSaving] = useState(false);
  const addNameRef = useRef<HTMLInputElement>(null);

  function openAddForm() {
    if (locations.length === 0) {
      addToast("먼저 위치를 등록하세요. 랙은 위치에 소속됩니다.", "error");
      return;
    }
    setAddForm((f) => ({
      ...f,
      location_id: (selectedLocation || f.location_id || locations[0]?.id || 0) as number,
      rack_name: "",
    }));
    setShowAddForm(true);
    requestAnimationFrame(() => addNameRef.current?.focus());
  }

  async function saveNewRack() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/racks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      const data = await res.json();
      if (res.ok) {
        setAddForm((f) => ({ ...f, rack_name: "" }));
        addToast("랙 추가됨 — 이름만 입력하면 같은 위치·크기로 계속 추가됩니다.", "success");
        router.refresh();
        requestAnimationFrame(() => addNameRef.current?.focus());
      } else {
        addToast(data.error || "저장에 실패했습니다.", "error");
      }
    } finally {
      setSaving(false);
    }
  }

  return {
    showAddForm,
    setShowAddForm,
    addForm,
    setAddForm,
    saving,
    addNameRef,
    openAddForm,
    saveNewRack,
  };
}
