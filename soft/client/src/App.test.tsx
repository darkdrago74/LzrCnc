import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App Component', () => {
    it('renders the header correctly', () => {
        render(<App />);
        expect(screen.getByText(/LzrCnc/i)).toBeDefined();
    });

    it('renders the connection panel', () => {
        render(<App />);
        expect(screen.getByText(/Connect Machine/i)).toBeDefined();
    });

    it('renders navigation buttons', () => {
        render(<App />);
        expect(screen.getByText('Machine')).toBeDefined();
        expect(screen.getByText('CAM')).toBeDefined();
    });

    it('renders macro panel and terminal', () => {
        render(<App />);
        expect(screen.getByText(/Unlock/i)).toBeDefined();
        expect(screen.getByText(/Z-Probe Wizard/i)).toBeDefined();
        expect(screen.getByText(/System Console/i)).toBeDefined();
    });
});
