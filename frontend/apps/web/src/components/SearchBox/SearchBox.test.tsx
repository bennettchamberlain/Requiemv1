import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';

import { SearchBox, type SearchResultItem } from './SearchBox';

const RESULTS: SearchResultItem[] = [
  { id: '1', content: <div>Result One</div> },
  { id: '2', content: <div>Result Two</div> },
];

describe('SearchBox', () => {
  it('renders an input with the given placeholder', () => {
    renderWithProviders(<SearchBox placeholder="Search memories" />);

    expect(screen.getByPlaceholderText('Search memories')).toBeInTheDocument();
  });

  it('debounced auto-submit fires onSearch with the typed query', async () => {
    const onSearch = vi.fn();
    renderWithProviders(<SearchBox autoSubmit autoSubmitDelay={30} onSearch={onSearch} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'coffee' } });

    await waitFor(() => expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ query: 'coffee' })));
  });

  it('Escape clears the input and notifies onClear', () => {
    const onClear = vi.fn();
    renderWithProviders(<SearchBox onClear={onClear} />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onClear).toHaveBeenCalled();
    expect(input).toHaveValue('');
  });

  it('shows results and selects one on click', () => {
    const onResultSelect = vi.fn();
    renderWithProviders(<SearchBox displayResults results={RESULTS} onResultSelect={onResultSelect} />);

    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'r' } });

    expect(screen.getByText('Result One')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Result Two'));
    expect(onResultSelect).toHaveBeenCalledWith(RESULTS[1]);
  });

  it('selects the highlighted result with arrow keys + Enter', () => {
    const onResultSelect = vi.fn();
    renderWithProviders(<SearchBox displayResults results={RESULTS} onResultSelect={onResultSelect} />);

    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'r' } });

    fireEvent.keyDown(input, { key: 'ArrowDown' }); // highlight first result
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onResultSelect).toHaveBeenCalledWith(RESULTS[0]);
  });

  it('ArrowDown with no results asks to pin the panel', () => {
    const onPanelPin = vi.fn();
    renderWithProviders(<SearchBox displayResults results={[]} onPanelPin={onPanelPin} />);

    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    expect(onPanelPin).toHaveBeenCalledTimes(1);
  });

  it('ArrowDown with results pages through them instead of pinning', () => {
    const onPanelPin = vi.fn();
    const onResultSelect = vi.fn();
    renderWithProviders(
      <SearchBox displayResults results={RESULTS} onPanelPin={onPanelPin} onResultSelect={onResultSelect} />,
    );

    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'r' } });

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onPanelPin).not.toHaveBeenCalled();
    expect(onResultSelect).toHaveBeenCalledWith(RESULTS[1]);
  });

  it('ArrowDown while the panel is pinned does not re-request the pin', () => {
    const onPanelPin = vi.fn();
    renderWithProviders(<SearchBox displayResults results={[]} panelPinned onPanelPin={onPanelPin} />);

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowDown' });

    expect(onPanelPin).not.toHaveBeenCalled();
  });

  it('Escape unpins a pinned panel before anything else', () => {
    const onPanelUnpin = vi.fn();
    const onClear = vi.fn();
    renderWithProviders(<SearchBox panelPinned onPanelUnpin={onPanelUnpin} onClear={onClear} />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onPanelUnpin).toHaveBeenCalledTimes(1);
    expect(onClear).not.toHaveBeenCalled();
    expect(input).toHaveValue('abc');
  });
});
