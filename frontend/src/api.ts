const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const PAGE_SIZE = 100;

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export interface ClusterOut {
  id: number;
  label: string | null;
  size: number;
  cover_face_id: number | null;
  cover_thumbnail: string | null;
  is_manual: boolean;
}

export interface ClusterSimilarOut extends ClusterOut {
  similarity: number;  // 0–1, higher = more similar
}

export interface FaceOut {
  id: number;
  bbox: number[];
  det_score: number | null;
  cluster_id: number | null;
  is_canonical?: boolean;
}

export interface FileOut {
  id: number;
  path: string;
  file_type: string;
  exif_date: string | null;
  exif_lat: number | null;
  exif_lon: number | null;
  file_modified: string | null;  // ISO datetime when file was last modified
  thumbnail_path: string | null;
  width: number | null;
  height: number | null;
  faces: FaceOut[];
}

export interface SearchResult {
  cluster_id: number | null;
  face_id: number;
  similarity: number;
  file_id: number;
  thumbnail_path: string | null;
  exif_date: string | null;
}

export interface Stats {
  total_files: number;
  total_photos: number;
  total_videos: number;
  total_faces: number;
  unassigned_faces: number;
}

export const api = {
  getPeople: (skip = 0, limit = 200) =>
    apiFetch<ClusterOut[]>(`/people/?skip=${skip}&limit=${limit}`),

  getPerson: (id: number) => apiFetch<ClusterOut>(`/people/${id}`),

  createPerson: (label?: string) =>
    apiFetch<ClusterOut>("/people/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label || null }),
    }),

  getSimilarPeople: (id: number, limit = 15, minSimilarity = 0.5) =>
    apiFetch<ClusterSimilarOut[]>(`/people/${id}/similar?limit=${limit}&min_similarity=${minSimilarity}`),

  getPersonPhotos: (id: number, skip = 0, limit = PAGE_SIZE) =>
    apiFetch<FileOut[]>(`/people/${id}/photos?skip=${skip}&limit=${limit}`),

  renamePerson: (id: number, label: string) =>
    apiFetch<ClusterOut>(`/people/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    }),

  setPersonCoverFace: (personId: number, faceId: number) =>
    apiFetch<ClusterOut>(`/people/${personId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cover_face_id: faceId }),
    }),

  faceCropByIdUrl: (faceId: number) => `${BASE}/faces/${faceId}/crop`,

  mergePeople: (sourceId: number, targetId: number) =>
    apiFetch<ClusterOut>("/people/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_id: sourceId, target_id: targetId }),
    }),

  getPhotos: (skip = 0, limit = 100) =>
    apiFetch<FileOut[]>(`/photos/?skip=${skip}&limit=${limit}`),

  updatePhotoDate: (photoId: number, exifDate: string | null) =>
    apiFetch<FileOut>(`/photos/${photoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exif_date: exifDate }),
    }),

  getPhotoDateMetadata: (photoId: number) =>
    apiFetch<{
      file_modified: string | null;
      file_created: string | null;
      exif_date: string | null;
      exif_datetime_original: string | null;
      exif_datetime_digitized: string | null;
      exif_image_datetime: string | null;
    }>(`/photos/${photoId}/date-metadata`),

  getStats: () => apiFetch<Stats>("/photos/stats/summary"),

  searchByFace: (file: File, topK = 20) => {
    const form = new FormData();
    form.append("file", file);
    return apiFetch<SearchResult[]>(`/search/face?top_k=${topK}`, {
      method: "POST",
      body: form,
    });
  },

  searchFaceFromRegion: (fileId: number, bbox: number[], topK = 20) =>
    apiFetch<SearchResult[]>(`/search/face-from-region?top_k=${topK}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId, bbox }),
    }),

  searchFacesFromRegion: (fileId: number, bbox: number[], topK = 10) =>
    apiFetch<{ faces: Array<{ bbox: number[]; det_score: number; suggestions: SearchResult[]; embedding_b64?: string }> }>(
      `/search/faces-from-region?top_k=${topK}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: fileId, bbox }),
      }
    ),

  addFaceToPerson: (
    personId: number,
    fileId: number,
    bbox: number[],
    opts?: { embedding_b64?: string; det_score?: number }
  ) =>
    apiFetch<ClusterOut>(`/people/${personId}/add-face`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_id: fileId,
        bbox,
        ...(opts?.embedding_b64 && { embedding_b64: opts.embedding_b64, det_score: opts.det_score ?? 0.9 }),
      }),
    }),

  assignFaceToPerson: (personId: number, faceId: number) =>
    apiFetch<ClusterOut>(`/people/${personId}/assign-face`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ face_id: faceId }),
    }),

  removeFaceFromPerson: (personId: number, faceId: number) =>
    apiFetch<ClusterOut>(`/people/${personId}/remove-face`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ face_id: faceId }),
    }),

  setFaceCanonical: (personId: number, faceId: number, isCanonical: boolean) =>
    apiFetch<ClusterOut>(`/people/${personId}/set-face-canonical`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ face_id: faceId, is_canonical: isCanonical }),
    }),

  triggerRecluster: (algorithm = "hdbscan", eps = 0.4) =>
    apiFetch<{ status: string }>(`/search/recluster?algorithm=${algorithm}&eps=${eps}`, {
      method: "POST",
    }),

  thumbnailUrl: (path: string | null) => {
    if (!path) return null;
    const name = path.replace(/\\/g, "/").split("/").pop();
    return `${BASE}/thumbnails/${name}`;
  },

  originalUrl: (fileId: number) => `${BASE}/originals/${fileId}`,

  faceCropUrl: (fileId: number, bbox: number[]) =>
    `${BASE}/originals/${fileId}/crop?bbox=${bbox.map((v) => v.toFixed(4)).join(",")}`,
};
