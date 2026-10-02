import { useEffect, useState } from 'react';

/** A temporary URL for previewing a blob, revoked when the blob changes or on unmount. */
export function useObjectUrl(blob: Blob | null | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    // The URL must be revoked, so it is created in an effect (with cleanup) rather than during render.
    const objectUrl = blob ? URL.createObjectURL(blob) : undefined;
    // oxlint-disable-next-line react/set-state-in-effect
    setUrl(objectUrl);
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [blob]);
  return url;
}
