"use client";

import { useState, useEffect } from "react";
import { Camera, X, Trash2, Upload } from "lucide-react";

interface Photo {
  id: number;
  filename: string;
  original_name: string;
}

export default function PhotoGallery({ assetId }: { assetId: number }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [uploading, setUploading] = useState(false);

  const fetchPhotos = async () => {
    try {
      const res = await fetch(`/api/assets/${assetId}/photos`);
      if (res.ok) {
        const data = await res.json();
        setPhotos(data);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPhotos();
  }, [assetId]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/assets/${assetId}/photos`, {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        await fetchPhotos();
      }
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleDelete = async (photoId: number) => {
    const res = await fetch(
      `/api/assets/${assetId}/photos?photoId=${photoId}`,
      { method: "DELETE" }
    );
    if (res.ok) {
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      if (selectedPhoto?.id === photoId) setSelectedPhoto(null);
    }
  };

  if (loading) {
    return <div className="text-sm text-slate-400">로딩 중...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700">사진</h3>
        <label className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 rounded cursor-pointer hover:bg-blue-100 transition-colors">
          <Upload className="w-3.5 h-3.5" />
          {uploading ? "업로드 중..." : "업로드"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleUpload}
            disabled={uploading}
          />
        </label>
      </div>

      {photos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-slate-400">
          <Camera className="w-10 h-10 mb-2" />
          <span className="text-sm">등록된 사진이 없습니다</span>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {photos.map((photo) => (
            <div key={photo.id} className="relative group">
              <img
                src={`/api/uploads/${photo.filename}`}
                alt={photo.original_name}
                className="w-20 h-20 object-cover rounded cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => setSelectedPhoto(photo)}
              />
              <button
                onClick={() => handleDelete(photo.id)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {selectedPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center"
          onClick={() => setSelectedPhoto(null)}
        >
          <div className="relative max-w-3xl max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setSelectedPhoto(null)}
              className="absolute -top-3 -right-3 w-8 h-8 bg-white text-slate-700 rounded-full flex items-center justify-center shadow-lg hover:bg-slate-100"
            >
              <X className="w-4 h-4" />
            </button>
            <img
              src={`/api/uploads/${selectedPhoto.filename}`}
              alt={selectedPhoto.original_name}
              className="max-w-full max-h-[80vh] rounded-lg"
            />
          </div>
        </div>
      )}
    </div>
  );
}
