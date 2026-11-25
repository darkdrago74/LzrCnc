import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App Component', () => {
    it('renders the brand and connection panel', () => {
        render(<App />);
        expect(screen.getByLabelText('LzrCnc')).toBeDefined();
        expect(screen.getByText(/Simulate/i)).toBeDefined();
    });

    it('renders navigation buttons', () => {
        render(<App />);
        expect(screen.getByTitle('Connection')).toBeDefined();
        expect(screen.getByTitle('CAM')).toBeDefined();
        expect(screen.getByTitle('Settings')).toBeDefined();
    });
});
