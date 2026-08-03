'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Loader2, User, Building2, Plus, X, BarChart3 } from 'lucide-react';
import { post, get } from './api-client';

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY'];

export default function AuthView({ onSession }) {
  const [step, setStep] = useState('login');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', display_name: '' });
  const [mode, setMode] = useState('personal');
  const [org, setOrg] = useState({ org_name: '', currency_code: 'INR' });
  const [inviteInput, setInviteInput] = useState('');
  const [invites, setInvites] = useState([]);
  const [demo, setDemo] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function showDemo() {
    try { setDemo(await get('/demo-accounts')); } catch { /* ignore */ }
  }

  async function login(email, password) {
    setBusy(true);
    try {
      onSession(await post('/auth/login', { email, password }));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function signup() {
    setBusy(true);
    try {
      const payload = {
        ...form,
        mode,
        org_name: mode === 'organization' ? org.org_name : undefined,
        currency_code: org.currency_code,
        invites: mode === 'organization' ? invites : [],
      };
      const session = await post('/auth/signup', payload);
      toast.success('Account created');
      onSession(session, { skippedInvites: mode === 'organization' && invites.length === 0 });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  const addInvite = () => {
    const v = inviteInput.trim().toLowerCase();
    if (v && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) && !invites.includes(v)) setInvites((a) => [...a, v]);
    setInviteInput('');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center bg-primary text-primary-foreground">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-base font-semibold leading-none tracking-tight">Ledger</p>
            <p className="text-xs text-muted-foreground">Expense &amp; budget tracking</p>
          </div>
        </div>

        {step === 'onboarding' ? (
          <Card className="border">
            <CardHeader>
              <CardTitle className="text-lg">How will you use Ledger?</CardTitle>
              <CardDescription>You always get a private personal workspace. Organizations are shared.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <RadioGroup value={mode} onValueChange={setMode} className="grid gap-3">
                <label htmlFor="m-personal" className={'flex cursor-pointer items-start gap-3 border p-4 transition-colors ' + (mode === 'personal' ? 'border-primary bg-accent' : 'hover:bg-muted/60')}>
                  <RadioGroupItem value="personal" id="m-personal" className="mt-0.5" />
                  <div className="space-y-1">
                    <p className="flex items-center gap-2 text-sm font-medium"><User className="h-4 w-4" /> Just for me</p>
                    <p className="text-xs text-muted-foreground">A private personal workspace only you can see.</p>
                  </div>
                </label>
                <label htmlFor="m-org" className={'flex cursor-pointer items-start gap-3 border p-4 transition-colors ' + (mode === 'organization' ? 'border-primary bg-accent' : 'hover:bg-muted/60')}>
                  <RadioGroupItem value="organization" id="m-org" className="mt-0.5" />
                  <div className="space-y-1">
                    <p className="flex items-center gap-2 text-sm font-medium"><Building2 className="h-4 w-4" /> For my team or business</p>
                    <p className="text-xs text-muted-foreground">Shared workspace with roles, scopes and an audit trail.</p>
                  </div>
                </label>
              </RadioGroup>

              {mode === 'organization' ? (
                <div className="space-y-4 border-t pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="org-name">Organization name</Label>
                    <Input id="org-name" placeholder="Nimbus Labs" value={org.org_name}
                      onChange={(e) => setOrg((o) => ({ ...o, org_name: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Currency</Label>
                    <Select value={org.currency_code} onValueChange={(v) => setOrg((o) => ({ ...o, currency_code: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="inv">Invite teammates <span className="text-muted-foreground">(optional)</span></Label>
                    <div className="flex gap-2">
                      <Input id="inv" placeholder="teammate@company.com" value={inviteInput}
                        onChange={(e) => setInviteInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addInvite(); } }} />
                      <Button type="button" variant="outline" onClick={addInvite}><Plus className="h-4 w-4" /></Button>
                    </div>
                    {invites.length ? (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {invites.map((em) => (
                          <Badge key={em} variant="secondary" className="gap-1 border">
                            {em}
                            <button type="button" onClick={() => setInvites((a) => a.filter((x) => x !== em))}><X className="h-3 w-3" /></button>
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStep('signup')}>Back</Button>
                <Button className="flex-1" onClick={signup}
                  disabled={busy || (mode === 'organization' && org.org_name.trim().length < 2)}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create workspace'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border">
            <CardHeader>
              <CardTitle className="text-lg">{step === 'login' ? 'Sign in' : 'Create your account'}</CardTitle>
              <CardDescription>
                {step === 'login' ? 'Use your email and password to continue.' : 'Next you will choose how your workspace is set up.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (step === 'login') login(form.email, form.password);
                  else setStep('onboarding');
                }}
              >
                {step === 'signup' ? (
                  <div className="space-y-2">
                    <Label htmlFor="name">Full name</Label>
                    <Input id="name" value={form.display_name} onChange={set('display_name')} placeholder="Aarav Sharma" required />
                  </div>
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" autoComplete="email" value={form.email} onChange={set('email')} placeholder="you@company.com" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" autoComplete={step === 'login' ? 'current-password' : 'new-password'}
                    value={form.password} onChange={set('password')} placeholder="At least 8 characters" required minLength={8} />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : step === 'login' ? 'Sign in' : 'Continue'}
                </Button>
              </form>

              <Separator className="my-4" />
              <button type="button" className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setStep(step === 'login' ? 'signup' : 'login')}>
                {step === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
              </button>

              {step === 'login' ? (
                <div className="mt-4 border bg-muted/50 p-3">
                  {demo ? (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium">Demo accounts &middot; password <code className="font-mono">demo1234</code></p>
                      {demo.accounts?.map((a) => (
                        <button key={a.email} type="button" disabled={busy}
                          className="flex w-full items-center justify-between border bg-background px-2 py-1.5 text-left text-xs hover:bg-accent"
                          onClick={() => login(a.email, 'demo1234')}>
                          <span className="font-medium">{a.display_name}</span>
                          <span className="text-muted-foreground">{a.email}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <button type="button" className="w-full text-xs text-muted-foreground hover:text-foreground" onClick={showDemo}>
                      Show demo accounts (owner / admin / member / own-only / viewer)
                    </button>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
