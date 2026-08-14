/* eslint-disable react-refresh/only-export-components -- paired site hook and selector */
import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

const STORAGE_KEY = 'pb-active-site';

export function useActiveSite() {
  const [sites, setSites] = useState([]);
  const [siteId, setSiteIdState] = useState(() => localStorage.getItem(STORAGE_KEY) || '');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.sites.list()
      .then((result) => {
        if (!active) return;
        setSites(result);
        if (!result.some((site) => site.id === siteId)) {
          const next = result[0]?.id || '';
          setSiteIdState(next);
          if (next) localStorage.setItem(STORAGE_KEY, next);
        }
      })
      .catch((nextError) => active && setError(nextError.message));
    return () => { active = false; };
  }, [siteId]);

  const setSiteId = (next) => {
    setSiteIdState(next);
    localStorage.setItem(STORAGE_KEY, next);
  };

  return {
    sites,
    siteId,
    site: sites.find((item) => item.id === siteId) || null,
    setSiteId,
    error,
  };
}

export function SiteSelect({ sites, siteId, setSiteId, name = 'siteId' }) {
  return (
    <label>
      <span>Сайт</span>
      <select name={name} required value={siteId} onChange={(event) => setSiteId(event.target.value)}>
        {!sites.length && <option value="">Нет активных сайтов</option>}
        {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
      </select>
    </label>
  );
}

