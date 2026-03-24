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
  file_id?: number | null;
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
  duration: number | null;  // seconds, for videos
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

export interface MemoryOut {
  id: number;
  label: string;
  cluster_id: number | null;
  file_count: number;
  cover_thumbnail: string | null;
}

export interface AlbumOut {
  id: number;
  label: string;
  file_count: number;
  cover_thumbnail: string | null;
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

  addVideoToPerson: (personId: number, fileId: number) =>
    apiFetch<ClusterOut>(`/people/${personId}/add-video?file_id=${fileId}`, {
      method: "POST",
    }),

  getPhotos: (skip = 0, limit = 100, fileType?: "photo" | "video") =>
    apiFetch<FileOut[]>(`/photos/?skip=${skip}&limit=${limit}${fileType ? `&file_type=${fileType}` : ""}`),

  getVideos: (skip = 0, limit = 100) =>
    apiFetch<FileOut[]>(`/photos/?skip=${skip}&limit=${limit}&file_type=video`),

  getPhoto: (photoId: number) => apiFetch<FileOut>(`/photos/${photoId}`),

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
  getFileExtensions: () =>
    apiFetch<{ extension: string; count: number; example_file_id: number; file_type: string }[]>(
      "/photos/file-extensions"
    ),

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

  // Recuerdos (memories)
  getMemories: () => apiFetch<MemoryOut[]>("/memories/"),
  createMemory: (label: string, clusterId?: number) =>
    apiFetch<MemoryOut>("/memories/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, cluster_id: clusterId ?? null }),
    }),
  getMemory: (id: number) => apiFetch<MemoryOut>(`/memories/${id}`),
  renameMemory: (memoryId: number, label: string) =>
    apiFetch<MemoryOut>(`/memories/${memoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    }),
  addFilesToMemory: (memoryId: number, fileIds: number[]) =>
    apiFetch<{ status: string }>(`/memories/${memoryId}/add-files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_ids: fileIds }),
    }),
  removeFileFromMemory: (memoryId: number, fileId: number) =>
    apiFetch<{ status: string }>(`/memories/${memoryId}/files/${fileId}`, {
      method: "DELETE",
    }),
  getMemoryPhotos: (memoryId: number) =>
    apiFetch<FileOut[]>(`/memories/${memoryId}/photos`),
  findSimilarMemoryInPage: (
    memoryId: number,
    fileIds: number[],
    minSimilarity = 0.35,
    forceClip = false,
    maxNew = 50
  ) =>
    apiFetch<{
      use_clip: boolean;
      sample_count: number;
      cached_count: number;
      computed_count: number;
      results: { file_id: number; similarity: number }[];
    }>(
      `/memories/${memoryId}/find-similar?min_similarity=${minSimilarity}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_ids: fileIds, force_clip: forceClip, max_new: maxNew }),
      }
    ),

  // Álbumes
  getAlbums: () => apiFetch<AlbumOut[]>("/albums/"),
  createAlbum: (label: string) =>
    apiFetch<AlbumOut>("/albums/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    }),
  getAlbum: (id: number) => apiFetch<AlbumOut>(`/albums/${id}`),
  renameAlbum: (albumId: number, label: string) =>
    apiFetch<AlbumOut>(`/albums/${albumId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    }),
  addFilesToAlbum: (albumId: number, fileIds: number[]) =>
    apiFetch<{ status: string }>(`/albums/${albumId}/add-files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_ids: fileIds }),
    }),
  removeFileFromAlbum: (albumId: number, fileId: number) =>
    apiFetch<{ status: string }>(`/albums/${albumId}/files/${fileId}`, {
      method: "DELETE",
    }),
  getAlbumPhotos: (albumId: number) =>
    apiFetch<(FileOut & { use_in_centroid?: boolean })[]>(`/albums/${albumId}/photos`),
  setAlbumFileUseInCentroid: (albumId: number, fileId: number, useInCentroid: boolean) =>
    apiFetch<{ status: string }>(`/albums/${albumId}/files/${fileId}/use-in-centroid`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ use_in_centroid: useInCentroid }),
    }),
  reorderAlbumPhotos: (albumId: number, fileIds: number[]) =>
    apiFetch<{ status: string }>(`/albums/${albumId}/reorder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_ids: fileIds }),
    }),
  findSimilarInPage: (
    albumId: number,
    fileIds: number[],
    minSimilarity = 0.35,
    forceClip = false,
    maxNew = 1000,
    excludeFacesFromCentroid = false
  ) =>
    apiFetch<{
      use_clip: boolean;
      sample_count: number;
      sample_file_ids?: number[];
      cached_count: number;
      computed_count: number;
      results: { file_id: number; similarity: number }[];
    }>(
      `/albums/${albumId}/find-similar?min_similarity=${minSimilarity}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_ids: fileIds,
          force_clip: forceClip,
          max_new: maxNew,
          exclude_faces_from_centroid: excludeFacesFromCentroid,
        }),
      }
    ),
  getAlbumSearchCacheStats: (albumId: number) =>
    apiFetch<{
      total_photos: number;
      cached_count: number;
      positive_count: number;
      negative_count: number;
      pending_count: number;
    }>(`/albums/${albumId}/search-cache-stats`),
  deleteAlbumSearchCache: (albumId: number) =>
    apiFetch<{ deleted: number }>(`/albums/${albumId}/search-cache`, { method: "DELETE" }),
  setCacheManualStatus: (albumId: number, fileId: number, status: "positive" | "negative") =>
    apiFetch<{ status: string; file_id: number }>(
      `/albums/${albumId}/search-cache/${fileId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }
    ),
  findSimilarLibrary: (
    albumId: number,
    maxNew = 1000,
    forceClip = true,
    excludeFacesFromCentroid = false
  ) =>
    apiFetch<{
      use_clip: boolean;
      sample_count: number;
      sample_file_ids?: number[];
      cached_count: number;
      computed_count: number;
      results: { file_id: number; similarity: number }[];
    }>(
      `/albums/${albumId}/find-similar-library?min_similarity=0.35&max_new=${maxNew}&force_clip=${forceClip}&exclude_faces_from_centroid=${excludeFacesFromCentroid}`
    ),
  getAlbumSearchCache: (
    albumId: number,
    status: "positive" | "negative" | "all" = "all",
    skip = 0,
    limit = 100,
    includeFiles = true
  ) =>
    apiFetch<{
      items: { file_id: number; similarity: number; file?: FileOut }[];
      total: number;
      status: string;
    }>(`/albums/${albumId}/search-cache?status=${status}&skip=${skip}&limit=${limit}&include_files=${includeFiles}`),

  /** Solo entre fileIds cargados en la página (p. ej. All Photos). No escanea toda la biblioteca. */
  findSimilarPersonInPage: (personId: number, fileIds: number[], minSimilarity = 0.35) =>
    apiFetch<{ file_id: number; similarity: number }[]>(
      `/people/${personId}/find-similar-in-page?min_similarity=${minSimilarity}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_ids: fileIds }),
      }
    ),
};
