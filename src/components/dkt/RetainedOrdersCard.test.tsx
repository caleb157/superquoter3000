import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RetainedOrdersCard } from './RetainedOrdersCard';
import { seedRows } from '@/lib/dkt-retained';

const noop = () => {};

describe('RetainedOrdersCard', () => {
  it('lists the starting rows, all unticked', () => {
    const rows = seedRows();
    render(<RetainedOrdersCard rows={rows} local={false} save={noop} countAll={noop} add={noop} remove={noop} />);
    expect(screen.getByText('Retained orders (simulation)')).toBeInTheDocument();
    expect(screen.getByText(`0 of ${rows.length} counted`)).toBeInTheDocument();
    expect(screen.getByLabelText('Count CCT container 2')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Count none' })).toBeDisabled();
  });

  it('ticks one row, or all of them', () => {
    const save = vi.fn(), countAll = vi.fn();
    render(<RetainedOrdersCard rows={seedRows()} local={false} save={save} countAll={countAll} add={noop} remove={noop} />);
    fireEvent.click(screen.getByLabelText('Count CCT container 2'));
    expect(save).toHaveBeenCalledWith('seed-0', { counted: true });
    fireEvent.click(screen.getByRole('button', { name: 'Count all' }));
    expect(countAll).toHaveBeenCalledWith(true);
  });

  it('shows what the counted rows add up to and warns when saved in this browser only', () => {
    const rows = seedRows().map((r, i) => ({ ...r, counted: i === 0 }));
    render(<RetainedOrdersCard rows={rows} local save={noop} countAll={noop} add={noop} remove={noop} />);
    expect(screen.getByText(/1 of \d+ counted · FOB \$33,404 · DKT margin \$3,340/)).toBeInTheDocument();
    expect(screen.getByText(/Saved in this browser only/)).toBeInTheDocument();
  });
});
