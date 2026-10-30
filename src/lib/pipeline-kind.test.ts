import { describe, expect, it } from 'vitest';
import { pipelineKind } from './master-analytics';

describe('pipelineKind', () => {
  it('uses the kind picked on the inquiry', () => {
    expect(pipelineKind('trading', 120)).toEqual({ kind: 'trading', kind_auto: false });
    expect(pipelineKind('manufacturing', 0)).toEqual({ kind: 'manufacturing', kind_auto: false });
  });
  it('falls back to labour man-hours', () => {
    expect(pipelineKind(null, 40)).toEqual({ kind: 'manufacturing', kind_auto: true });
    expect(pipelineKind(undefined, 0)).toEqual({ kind: 'trading', kind_auto: true });
  });
});
