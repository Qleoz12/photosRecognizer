/**
 * Debe coincidir con el puerto del API (p. ej. `start.bat` usa uvicorn en 8732).
 * Si `VITE_API_URL` está vacío, `??` no aplica: el fetch iría al origen del Vite y devolvería index.html → "Unexpected token '<'".
 */
const DEFAULT_API_BASE = "http://localhost:8732";

function getApiBase(): string {
  const raw = import.meta.env.VITE_API_URL;
  if (raw == null || String(raw).trim() === "") {
    return DEFAULT_API_BASE;
  }
  return String(raw).replace(/\/+$/, "");
}

export const API_BASE = getApiBase();
const BASE = API_BASE;

/** Mismo valor que PHOTOS_SHARE_CREATE_SECRET en el .env del API si protegés POST /api/share/create. */
const SHARE_CREATE_SECRET = String(import.meta.env.VITE_PHOTOS_SHARE_CREATE_SECRET ?? "").trim();

/**
 * Base para API y medios en la vista pública `/share/:token`.
 * Debe ser el origen de la página (ngrok, localhost:5892, etc.), nunca API_BASE:
 * en el navegador del invitado `localhost:8732` es su propio PC.
 */
export function sharePublicBaseUrl(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}
const PAGE_SIZE = 100;

/** PIN de 7 dígitos (solo en memoria de sesión del navegador tras verificar). */
const ARCHIVE_PIN_KEY = "photos_archive_pin";

export function getStoredArchivePin(): string | null {
  try {
    return sessionStorage.getItem(ARCHIVE_PIN_KEY);
  } catch {
    return null;
  }
}

export function setStoredArchivePin(pin: string | null): void {
  try {
    if (pin) sessionStorage.setItem(ARCHIVE_PIN_KEY, pin);
    else sessionStorage.removeItem(ARCHIVE_PIN_KEY);
  } catch {
    /* ignore */
  }
}

function apiTimingEnv(): { verbose: boolean; slowMs: number } {
  const v = import.meta.env.VITE_LOG_API_TIMING;
  const verbose =
    import.meta.env.DEV ||
    v === "true" ||
    v === "1";
  const raw = import.meta.env.VITE_SLOW_API_MS;
  const slowMs = Math.max(0, Number(raw ?? "1000") || 1000);
  return { verbose, slowMs };
}

function logApiTiming(
  method: string,
  pathLabel: string,
  t0: number,
  detail: string,
  opts?: { error?: boolean }
): void {
  const { verbose, slowMs } = apiTimingEnv();
  const ms = Math.round(performance.now() - t0);
  if (!verbose && ms < slowMs && !opts?.error) return;
  const msg = `[API] ${method} ${pathLabel} ${detail} | ${ms}ms`;
  if (opts?.error || ms >= slowMs * 2) console.warn(msg);
  else if (ms >= slowMs) console.info(msg);
  else console.debug(msg);
}

const API_FETCH_TIMEOUT_MS = Math.max(
  0,
  Number(String(import.meta.env.VITE_API_FETCH_TIMEOUT_MS ?? "").trim()) || 300_000,
);

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const method = (options?.method ?? "GET").toUpperCase();
  const url = `${BASE}${path}`;
  const pathLabel = path.length > 120 ? `${path.slice(0, 120)}…` : path;
  const t0 = performance.now();

  let signal = options?.signal;
  if (
    signal == null &&
    API_FETCH_TIMEOUT_MS > 0 &&
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
  ) {
    signal = AbortSignal.timeout(API_FETCH_TIMEOUT_MS);
  }

  let res: Response;
  try {
    res = await fetch(url, { ...options, signal });
  } catch (e) {
    logApiTiming(method, pathLabel, t0, "→ fetch failed", { error: true });
    throw e;
  }

  const text = await res.text();
  if (!res.ok) {
    logApiTiming(method, pathLabel, t0, `→ HTTP ${res.status}`);
    throw new Error(`API ${res.status}: ${text.slice(0, 400)}`);
  }
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) {
    logApiTiming(method, pathLabel, t0, "→ HTML not JSON", { error: true });
    throw new Error(
      `La API devolvió HTML en lugar de JSON. Revisa VITE_API_URL (debe apuntar al servidor FastAPI, p. ej. ${DEFAULT_API_BASE}). Petición: ${url}`
    );
  }
  try {
    const data = JSON.parse(text) as T;
    logApiTiming(method, pathLabel, t0, `→ ${res.status}`);
    return data;
  } catch (e) {
    logApiTiming(method, pathLabel, t0, "→ bad JSON", { error: true });
    throw new Error(`Respuesta no JSON (${url}): ${String(e)} · ${text.slice(0, 120)}`);
  }
}

export interface ClusterOut {
  id: number;
  label: string | null;
  size: number;
  cover_face_id: number | null;
  cover_thumbnail: string | null;
  is_manual: boolean;
  is_hidden?: boolean;
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
  archived?: boolean;
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
  archived_count?: number;
  /** No archivados, con fecha EXIF */
  dated_count?: number;
  /** No archivados, sin fecha EXIF */
  undated_count?: number;
  total_photos: number;
  total_videos: number;
  total_faces: number;
  unassigned_faces: number;
  /** Personas (clusters) marcadas como ocultas */
  hidden_people_count?: number;
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
  getPeople: (skip = 0, limit = 200, includeHidden = false) =>
    apiFetch<ClusterOut[]>(
      `/people/?skip=${skip}&limit=${limit}&include_hidden=${includeHidden ? "true" : "false"}`,
    ),

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

  /** ZIP con todas las fotos/vídeos de la persona (GET directo, no JSON). */
  personDownloadZipUrl: (personId: number) => `${BASE}/people/${personId}/download.zip`,

  createShareCollection: (personIds: number[], ttlHours = 24) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (SHARE_CREATE_SECRET) headers["X-Photos-Share-Secret"] = SHARE_CREATE_SECRET;
    return apiFetch<{ token: string; expires_at: string; path_prefix: string }>("/api/share/create", {
      method: "POST",
      headers,
      body: JSON.stringify({ person_ids: personIds, ttl_hours: ttlHours }),
    });
  },

  /** Estado de túneles ngrok vía API local (el backend llama a 127.0.0.1:4040). */
  getNgrokTunnels: () =>
    apiFetch<{
      tunnels?: Array<{ public_url?: string; proto?: string; config?: { addr?: string } }>;
      _photos_recognizer?: { ok?: boolean; error?: string };
    }>("/photos/ngrok-tunnels"),

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

  updatePerson: (
    id: number,
    body: { label?: string | null; cover_face_id?: number; is_hidden?: boolean },
  ) =>
    apiFetch<ClusterOut>(`/people/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  faceCropByIdUrl: (faceId: number) => `${BASE}/faces/${faceId}/crop`,

  mergePeople: (sourceId: number, targetId: number) =>
    apiFetch<ClusterOut>("/people/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_id: sourceId, target_id: targetId }),
    }),

  /** strictFaces: si true, exige rostro ya indexado (error 400 si no hay). Default false = permite placeholder CLIP. */
  addVideoToPerson: (personId: number, fileId: number, strictFaces = false) =>
    apiFetch<ClusterOut>(
      `/people/${personId}/add-video?file_id=${fileId}${strictFaces ? "&strict_faces=true" : ""}`,
      { method: "POST" },
    ),

  getPhotos: (
    skip = 0,
    limit = 100,
    fileTypeOrOpts?: "photo" | "video" | { fileType?: "photo" | "video"; hasExifDate?: boolean },
  ) => {
    const params = new URLSearchParams();
    params.set("skip", String(skip));
    params.set("limit", String(limit));
    let fileType: "photo" | "video" | undefined;
    let hasExifDate: boolean | undefined;
    if (typeof fileTypeOrOpts === "string") {
      fileType = fileTypeOrOpts;
    } else if (fileTypeOrOpts && typeof fileTypeOrOpts === "object") {
      fileType = fileTypeOrOpts.fileType;
      hasExifDate = fileTypeOrOpts.hasExifDate;
    }
    if (fileType) params.set("file_type", fileType);
    if (hasExifDate === true) params.set("has_exif_date", "true");
    if (hasExifDate === false) params.set("has_exif_date", "false");
    return apiFetch<FileOut[]>(`/photos/?${params.toString()}`);
  },

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

  getPhotoStatsByYear: () =>
    apiFetch<{ by_year: Array<{ year: string; count: number }> }>("/photos/stats/by-year"),

  batchSetExifYear: (fileIds: number[], year: number) =>
    apiFetch<{ updated: number }>("/photos/batch/exif-year", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_ids: fileIds, year }),
    }),

  getArchiveStatus: () => apiFetch<{ configured: boolean }>("/photos/archive/status"),
  verifyArchivePin: (pin: string) =>
    apiFetch<{ ok: boolean }>("/photos/archive/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    }),
  listArchivedPhotos: (skip = 0, limit = 100, fileType?: "photo" | "video") => {
    const pin = getStoredArchivePin();
    if (!pin) throw new Error("PIN no configurado en esta sesión");
    return apiFetch<FileOut[]>(
      `/photos/archive/list?skip=${skip}&limit=${limit}${fileType ? `&file_type=${fileType}` : ""}`,
      { headers: { "X-Archive-Pin": pin } }
    );
  },
  archiveFiles: (fileIds: number[]) =>
    apiFetch<{ archived: number }>("/photos/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_ids: fileIds }),
    }),
  unarchiveFiles: (fileIds: number[]) => {
    const pin = getStoredArchivePin();
    if (!pin) throw new Error("PIN no configurado en esta sesión");
    return apiFetch<{ restored: number }>("/photos/archive/unarchive", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Archive-Pin": pin },
      body: JSON.stringify({ file_ids: fileIds }),
    });
  },
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

  triggerRecluster: (algorithm = "hdbscan", eps = 0.6) =>
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
    maxNew = 500,
    excludeFacesFromCentroid = false
  ) =>
    apiFetch<{
      use_clip: boolean;
      sample_count: number;
      sample_file_ids?: number[];
      cached_count: number;
      computed_count: number;
      pool_size?: number;
      uncached_remaining_after?: number;
      total_cached_album?: number;
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
  setCacheManualStatusBatch: (
    albumId: number,
    fileIds: number[],
    status: "positive" | "negative"
  ) =>
    apiFetch<{ updated: number; file_ids: number[]; status: string }>(
      `/albums/${albumId}/search-cache`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_ids: fileIds, status }),
      }
    ),
  findSimilarLibrary: (
    albumId: number,
    maxNew = 500,
    forceClip = true,
    excludeFacesFromCentroid = false
  ) =>
    apiFetch<{
      use_clip: boolean;
      sample_count: number;
      sample_file_ids?: number[];
      cached_count: number;
      computed_count: number;
      pool_size?: number;
      uncached_remaining_after?: number;
      total_cached_album?: number;
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
    apiFetch<{
      results: { file_id: number; similarity: number }[];
      pool_size: number;
      skipped_already_in_person: number;
      skipped_no_faces: number;
    }>(`/people/${personId}/find-similar-in-page?min_similarity=${minSimilarity}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_ids: fileIds }),
    }),
};
