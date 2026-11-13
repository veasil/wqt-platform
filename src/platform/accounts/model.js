// Switch the entire authentication/resource chain together. Legacy remains the deployment default.
export function accountModelEnabled() {
  const mode=process.env.WQT_ACCOUNT_MODEL;
  if (mode && !['accounts','legacy'].includes(mode)) throw new Error('WQT_ACCOUNT_MODEL must be accounts or legacy');
  return mode === 'accounts';
}
