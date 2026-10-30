'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { ErrorNotice } from './bits';

export interface FolderListing {
  path: string;
  parent: string | null;
  entries: { name: string; path: string; isProject: boolean }[];
  project?: { name: string; suggestedProject: string; framework: string; supported: boolean; hasBuildScript: boolean };
}

export default function FolderPicker({ start, onPick, onClose }: { start?: string; onPick: (path: string) => void; onClose: () => void }) {
  const [listing, setListing] = useState<FolderListing>();
  const [error, setError] = useState<string>();
  const [path, setPath] = useState(start ?? '');

  useEffect(() => {
    let cancelled = false;
    api<FolderListing>(`/api/fs?path=${encodeURIComponent(path)}`)
      .then((l) => !cancelled && (setListing(l), setError(undefined)))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Choose a folder">
        <h2>Choose your project folder</h2>
        <ErrorNotice message={error} />
        {listing && (
          <>
            <p className="mono small" style={{ wordBreak: 'break-all' }}>{listing.path}</p>
            <div className="folders" style={{ marginBottom: 12 }}>
              {listing.parent && <button onClick={() => setPath(listing.parent!)}>.. (up)</button>}
              {listing.entries.map((e) => (
                <button key={e.path} onClick={() => setPath(e.path)}>
                  {e.name} {e.isProject && <span className="badge ok">project</span>}
                </button>
              ))}
              {listing.entries.length === 0 && <div className="muted" style={{ padding: 10 }}>No sub-folders.</div>}
            </div>
            {listing.project && (
              <p className="small muted">
                This folder: {listing.project.name} ({listing.project.framework}).
              </p>
            )}
          </>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!listing} onClick={() => listing && onPick(listing.path)}>
            Use this folder
          </button>
        </div>
      </div>
    </div>
  );
}
