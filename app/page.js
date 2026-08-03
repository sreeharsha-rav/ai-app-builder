'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { get, post } from '@/components/app/api-client';
import AuthView from '@/components/app/auth-view';
import Shell from '@/components/app/shell';
import { BarChart3 } from 'lucide-react';

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex items-center gap-2.5 text-muted-foreground">
        <div className="flex h-9 w-9 animate-pulse items-center justify-center bg-primary text-primary-foreground">
          <BarChart3 className="h-5 w-5" />
        </div>
        <span className="text-sm">Loading your workspaces...</span>
      </div>
    </div>
  );
}

const App = () => {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setSession(await get('/auth/me'));
      } catch {
        setSession(null);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  async function logout() {
    try { await post('/auth/logout'); } catch { /* ignore */ }
    setSession(null);
    toast.success('Signed out');
  }

  if (booting) return <Splash />;
  if (!session) return <AuthView onSession={(s) => setSession(s)} />;
  return <Shell session={session} setSession={setSession} onLogout={logout} />;
};

export default App;
