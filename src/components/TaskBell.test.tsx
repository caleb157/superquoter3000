import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  assigneeCode: 'PH' as string | null,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ assigneeCode: mocks.assigneeCode }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: mocks.from },
}));
vi.mock('@/components/TaskList', () => ({ TaskList: () => null }));

import { TaskBell } from './TaskBell';

let visibility: DocumentVisibilityState;
const interval = 5 * 60 * 1000;

async function changeVisibility(state: DocumentVisibilityState) {
  visibility = state;
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

async function mount() {
  let result: ReturnType<typeof render> | undefined;
  await act(async () => {
    result = render(<MemoryRouter><TaskBell /></MemoryRouter>);
  });
  return result;
}

describe('TaskBell visibility-aware polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    mocks.assigneeCode = 'PH';
    mocks.from.mockReset();
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lte: vi.fn().mockResolvedValue({ count: 2 }),
    };
    mocks.from.mockReturnValue(query);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stops requests and the polling timer while the tab is inactive', async () => {
    await mount();
    expect(mocks.from).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(interval); });
    expect(mocks.from).toHaveBeenCalledTimes(2);
    await changeVisibility('hidden');
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { vi.advanceTimersByTime(interval * 3); });
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });

  it('refreshes immediately on return and resumes one polling timer', async () => {
    await mount();
    await changeVisibility('hidden');
    await changeVisibility('visible');
    expect(mocks.from).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => { vi.advanceTimersByTime(interval); });
    expect(mocks.from).toHaveBeenCalledTimes(3);
  });

  it('does not fetch or start polling when mounted in an inactive tab', async () => {
    visibility = 'hidden';
    await mount();
    await act(async () => { vi.advanceTimersByTime(interval * 2); });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await changeVisibility('visible');
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it('cleans up polling and visibility listeners on unmount', async () => {
    const result = await mount();
    result?.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await changeVisibility('hidden');
    await changeVisibility('visible');
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it('does not poll without a task assignee', async () => {
    mocks.assigneeCode = null;
    await mount();
    await changeVisibility('hidden');
    await changeVisibility('visible');
    expect(mocks.from).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});