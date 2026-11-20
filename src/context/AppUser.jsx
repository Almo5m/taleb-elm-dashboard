import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

const AppUserCtx = createContext(null);
const RefreshCtx = createContext(() => {});

export function AppUserProvider({ userId, children }) {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('id, name, role, avatar_url').eq('id', userId).single();
    setMe(data);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    let active = true;
    supabase
      .from('profiles')
      .select('id, name, role, avatar_url')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (active) {
          setMe(data);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [userId]);

  if (loading) return null;

  return (
    <AppUserCtx.Provider value={me}>
      <RefreshCtx.Provider value={load}>{children}</RefreshCtx.Provider>
    </AppUserCtx.Provider>
  );
}

export function useAppUser() {
  return useContext(AppUserCtx);
}

/** بيعيد تحميل بيانات الأدمن الحالي (بعد تغيير الصورة مثلًا) */
export function useRefreshAppUser() {
  return useContext(RefreshCtx);
}

export function useIsFullAdmin() {
  const me = useAppUser();
  return me?.role === 'admin';
}
