'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Loader2, LogOut, Moon, Sun } from 'lucide-react';
import { put } from './api-client';
import { PageHeader } from './bits';
import { fmtDate, initials } from '@/lib/format';

export default function ProfileView({ session, setSession, dark, toggleTheme, onLogout }) {
  const [name, setName] = useState(session.user.display_name);
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [busy, setBusy] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);

  async function saveName() {
    setBusy(true);
    try {
      setSession(await put('/auth/profile', { display_name: name }));
      toast.success('Profile updated');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function savePassword() {
    setPwBusy(true);
    try {
      await put('/auth/profile', pw);
      setPw({ current_password: '', new_password: '' });
      toast.success('Password changed');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Profile" description="Your account details apply across every workspace." />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
          <CardDescription>Member since {fmtDate(session.user.created_at)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center border bg-muted text-lg font-semibold">
              {initials(session.user.display_name)}
            </div>
            <div className="min-w-0">
              <p className="truncate font-medium">{session.user.display_name}</p>
              <p className="truncate text-sm text-muted-foreground">{session.user.email}</p>
            </div>
          </div>
          <Separator />
          <div className="space-y-2">
            <Label htmlFor="dn">Display name</Label>
            <Input id="dn" value={name} onChange={(e) => setName(e.target.value)} className="max-w-md" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="em">Email</Label>
            <Input id="em" value={session.user.email} readOnly disabled className="max-w-md" />
          </div>
          <Button onClick={saveName} disabled={busy || name.trim().length < 2}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save profile'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change password</CardTitle>
          <CardDescription>Use at least 8 characters.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cp">Current password</Label>
            <Input id="cp" type="password" className="max-w-md" value={pw.current_password}
              onChange={(e) => setPw((p) => ({ ...p, current_password: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="np">New password</Label>
            <Input id="np" type="password" className="max-w-md" value={pw.new_password}
              onChange={(e) => setPw((p) => ({ ...p, new_password: e.target.value }))} />
          </div>
          <Button variant="outline" onClick={savePassword} disabled={pwBusy || pw.new_password.length < 8}>
            {pwBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Change password'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appearance & session</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2" onClick={toggleTheme}>
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />} {dark ? 'Switch to light' : 'Switch to dark'}
          </Button>
          <Button variant="destructive" className="gap-2" onClick={onLogout}>
            <LogOut className="h-4 w-4" /> Log out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
