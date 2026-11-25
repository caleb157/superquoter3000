import { describe, expect, it } from 'vitest';
import { ACCOUNTS_PATH, accountBackTarget, accountPath, fromSalesTab, redirectFromCustomers, salesTabPath } from '../account-link';

describe('account links from Sales', () => {
  it('remembers the Sales tab an account was opened from', () => {
    expect(fromSalesTab('needs')).toEqual({ from: { label: 'Needs you', path: '/sales?tab=needs' } });
    expect(fromSalesTab('overview').from.path).toBe('/sales');
    expect(salesTabPath('pipeline')).toBe('/sales?tab=pipeline');
    expect(accountPath('abc')).toBe('/customers/abc?tab=sales');
  });

  it('Back returns to that tab', () => {
    expect(accountBackTarget(fromSalesTab('needs'))).toEqual({ label: 'Needs you', path: '/sales?tab=needs' });
    expect(accountBackTarget({ from: { label: 'Tasks', path: '/tasks' } }).path).toBe('/tasks');
  });

  it('never sends Back to the old Customers list, and falls back to Sales > Accounts', () => {
    expect(accountBackTarget(null)).toEqual({ label: 'Accounts', path: ACCOUNTS_PATH });
    expect(accountBackTarget({ from: { label: 'Customers', path: '/customers' } }).path).toBe(ACCOUNTS_PATH);
    expect(accountBackTarget({ from: { label: 'x', path: '/customers?tab=leads' } }).path).toBe(ACCOUNTS_PATH);
    expect(accountBackTarget({ from: { label: 'x', path: '//evil.example' } }).path).toBe(ACCOUNTS_PATH);
  });

  it('old /customers links land on Sales > Accounts', () => {
    expect(redirectFromCustomers('')).toBe('/sales?tab=accounts');
    expect(redirectFromCustomers('?tab=leads')).toBe('/sales?tab=accounts&group=leads');
  });
});
