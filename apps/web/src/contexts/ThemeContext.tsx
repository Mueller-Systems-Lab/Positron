import {
	createContext,
	type ReactElement,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useState,
} from 'react';

type Theme = 'dark' | 'light';
const STORAGE_KEY = 'positron:theme';

interface ThemeContextValue {
	theme: Theme;
	toggleTheme: () => void;
	isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getInitialTheme(): Theme {
	if (typeof window === 'undefined') return 'dark';
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored === 'light' || stored === 'dark') return stored;
	} catch {
		/* localStorage not available */
	}
	return 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
	const [theme, setTheme] = useState<Theme>(getInitialTheme);

	// Sync <html> class with theme
	useEffect(() => {
		const root = document.documentElement;
		if (theme === 'dark') {
			root.classList.add('dark');
		} else {
			root.classList.remove('dark');
		}
		try {
			localStorage.setItem(STORAGE_KEY, theme);
		} catch {
			/* ignore */
		}
		// Update meta theme-color
		const meta = document.querySelector('meta[name="theme-color"]');
		if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f172a' : '#f8fafc');
	}, [theme]);

	// Listen for OS theme changes
	useEffect(() => {
		const mq = window.matchMedia('(prefers-color-scheme: light)');
		const handler = (e: MediaQueryListEvent) => {
			// Only auto-switch if user hasn't explicitly chosen
			try {
				if (!localStorage.getItem(STORAGE_KEY)) {
					setTheme(e.matches ? 'light' : 'dark');
				}
			} catch {
				/* ignore */
			}
		};
		mq.addEventListener('change', handler);
		return () => mq.removeEventListener('change', handler);
	}, []);

	const toggleTheme = useCallback(() => {
		setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
	}, []);

	return (
		<ThemeContext.Provider value={{ theme, toggleTheme, isDark: theme === 'dark' }}>
			{children}
		</ThemeContext.Provider>
	);
}

export function useTheme(): ThemeContextValue {
	const ctx = useContext(ThemeContext);
	if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
	return ctx;
}
