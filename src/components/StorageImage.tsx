import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  bucket: string;
  path?: string | null;
  /** Fallback element rendered when path is empty or fails to load */
  fallback?: React.ReactNode;
  /** Signed URL TTL in seconds (default 1h) */
  ttl?: number;
};

// Simple in-memory cache to avoid re-issuing signed URLs each render.
const cache = new Map<string, { url: string; expiresAt: number }>();

async function resolve(bucket: string, path: string, ttl: number): Promise<string | null> {
  // External URL — return as-is (legacy data may already hold a full URL).
  if (/^https?:\/\//i.test(path)) return path;

  const key = `${bucket}:${path}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.url;

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttl);
  if (error || !data?.signedUrl) return null;
  cache.set(key, { url: data.signedUrl, expiresAt: Date.now() + ttl * 1000 });
  return data.signedUrl;
}

export function useStorageUrl(bucket: string, path?: string | null, ttl = 3600) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!path) { setUrl(null); return; }
    resolve(bucket, path, ttl).then(u => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [bucket, path, ttl]);
  return url;
}

export function StorageImage({ bucket, path, fallback = null, ttl, ...imgProps }: Props) {
  const url = useStorageUrl(bucket, path, ttl);
  if (!path || !url) return <>{fallback}</>;
  return <img src={url} {...imgProps} />;
}
