export const CAT_TOKENS = ['cat-1', 'cat-2', 'cat-3', 'cat-4', 'cat-5', 'cat-6', 'cat-7', 'cat-8'];

export const catVar = (token) => `var(--${CAT_TOKENS.includes(token) ? token : 'cat-8'})`;

const LOCALE = { INR: 'en-IN', USD: 'en-US', EUR: 'de-DE', GBP: 'en-GB', AED: 'en-AE', SGD: 'en-SG', AUD: 'en-AU', CAD: 'en-CA', JPY: 'ja-JP' };

/** Money lives as integer minor units everywhere; we format only at the edge. */
export function money(minor, currency = 'INR', opts = {}) {
  const value = (Number(minor) || 0) / 100;
  try {
    return new Intl.NumberFormat(LOCALE[currency] || 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: opts.decimals ?? 0,
      maximumFractionDigits: opts.decimals ?? 0,
      notation: opts.compact ? 'compact' : 'standard',
    }).format(value);
  } catch {
    return currency + ' ' + value.toFixed(opts.decimals ?? 0);
  }
}

export const currencySymbol = (currency = 'INR') => {
  try {
    return new Intl.NumberFormat(LOCALE[currency] || 'en-US', { style: 'currency', currency, maximumFractionDigits: 0 })
      .format(0).replace(/[\d\s.,]/g, '') || currency;
  } catch {
    return currency;
  }
};

export const fmtDate = (iso, opts) => {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00Z' : iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: opts?.year === false ? undefined : 'numeric', timeZone: 'UTC' });
};

export const fmtDateTime = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export const todayIso = () => new Date().toISOString().slice(0, 10);

export const monthStartIso = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)).toISOString().slice(0, 10);
};

export const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';

export const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' };
